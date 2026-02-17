const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const cluster = require('cluster');
const os = require('os');

// Configuração de Cluster para produção
const USE_CLUSTER = process.env.NODE_ENV === 'production';
const numCPUs = os.cpus().length;

if (USE_CLUSTER && cluster.isMaster) {
    console.log(`🚀 Master ${process.pid} iniciando ${numCPUs} workers...`);
    
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker, code, signal) => {
        console.log(`⚠️ Worker ${worker.process.pid} morreu. Reiniciando...`);
        cluster.fork();
    });
    
} else {
    // Worker process
    startServer();
}

function startServer() {

// Configuração Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
    console.error("ERRO CRÍTICO: A variável de ambiente STRIPE_SECRET_KEY não foi definida!");
}
const stripe = require('stripe')(stripeSecretKey);

// Caminhos SSL
const sslKeyPath = path.join(__dirname, '..', 'ssl', 'private-key.pem');
const sslCertPath = path.join(__dirname, '..', 'ssl', 'certificate.pem');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const HTTP_PORT = process.env.HTTP_PORT || 3000;

// ==================== OTIMIZAÇÕES PARA PRODUÇÃO ====================

// 1. Compressão GZIP
const compression = require('compression');
app.use(compression());

// 2. Rate Limiting (previne DDoS e abuso)
const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requests por IP
    message: 'Demasiados pedidos deste IP. Tente novamente mais tarde.'
});

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 50, // 50 uploads por hora
    message: 'Limite de uploads atingido. Tente novamente mais tarde.'
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // 10 tentativas de login
    message: 'Demasiadas tentativas de login. Tente novamente em 15 minutos.'
});

app.use('/api/', generalLimiter);
app.use('/api/upload_chunk', uploadLimiter);
app.use('/api/auth/', authLimiter);

// 3. Helmet para segurança de headers HTTP
const helmet = require('helmet');
app.use(helmet({
    contentSecurityPolicy: false, // Desativado para permitir CDNs externos
    crossOriginEmbedderPolicy: false
}));

// 4. CORS configurado
const corsOptions = {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-owner-key', 'x-auth-token', 'stripe-signature'],
    credentials: true
};
app.use(cors(corsOptions));

// 5. Trust proxy (para Cloudflare, nginx, etc.)
app.set('trust proxy', 1);

// ==================== MIDDLEWARE ====================

// Webhook raw body
app.post('/webhook', express.raw({type: 'application/json'}), async (request, response) => {
  const sig = request.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (endpointSecret) {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } else {
        event = JSON.parse(request.body);
    }
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    response.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  switch (event.type) {
    case 'charge.refunded':
      const refund = event.data.object;
      console.log('Reembolso detetado:', refund.id);
      if (refund.billing_details && refund.billing_details.email) {
          removePremiumByEmail(refund.billing_details.email);
      } else if (refund.receipt_email) {
          removePremiumByEmail(refund.receipt_email);
      } else {
          const paymentIntentId = refund.payment_intent;
          try {
              const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
              if (pi.receipt_email) {
                  removePremiumByEmail(pi.receipt_email);
              } else if (pi.charges && pi.charges.data[0] && pi.charges.data[0].billing_details) {
                  removePremiumByEmail(pi.charges.data[0].billing_details.email);
              }
          } catch(e) { console.error("Erro ao buscar PI do reembolso:", e); }
      }
      break;
  }

  response.send();
});

app.use(express.json({ limit: '1mb' }));

// Logging de requests em produção
if (process.env.NODE_ENV === 'production') {
    const morgan = require('morgan');
    app.use(morgan('combined'));
}

// Servir ficheiros com streaming e cache
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '7d', // Cache de 7 dias
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        res.set("Accept-Ranges", "bytes");
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "public, max-age=604800");
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = getMimeType(filePath);
        if (mimeType) {
            res.set("Content-Type", mimeType);
        }
    }
}));

// Middleware global de erros
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// ==================== PERSISTÊNCIA ====================

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'database.json');
const USERS_DB_PATH = path.join(__dirname, 'users.json');
let files = [];
let users = [];

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) {
            files = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        }
        if (fs.existsSync(USERS_DB_PATH)) {
            users = JSON.parse(fs.readFileSync(USERS_DB_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('Erro ao carregar base de dados:', e);
    }
}
loadDB();

function saveDB() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(files, null, 2));
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error('Erro ao salvar base de dados:', e);
    }
}

function isUserPremium(key) {
    const user = users.find(u => u.key === key);
    return user && user.isPremium;
}

function removePremiumByEmail(email) {
    const user = users.find(u => u.email === email);
    if (user) {
        user.isPremium = false;
        console.log(`PREMIUM REMOVIDO: ${email}`);
        saveDB();
    }
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Gerar token de sessão simples (JWT seria melhor em produção real)
function generateAuthToken(key) {
    const payload = `${key}:${Date.now()}`;
    return crypto.createHash('sha256').update(payload + process.env.JWT_SECRET || 'evertech-secret').digest('hex');
}

// Verificar autenticação
function verifyAuth(req) {
    const token = req.headers['x-auth-token'];
    const key = req.headers['x-owner-key'] || req.query.key;
    
    if (!key) return null;
    
    const user = users.find(u => u.key === key);
    return user ? key : null;
}

// ==================== AUTH ====================

app.post('/api/auth/login', (req, res) => {
    const { key, password } = req.body;

    if (!key || !password) {
        return res.status(400).json({ error: 'Chave e password são obrigatórios' });
    }

    const userIndex = users.findIndex(u => u.key === key);

    if (userIndex === -1) {
        const newUser = {
            key: key,
            passwordHash: hashPassword(password),
            isPremium: false,
            createdAt: new Date()
        };
        users.push(newUser);
        saveDB();
        const token = generateAuthToken(key);
        return res.json({ success: true, message: 'Conta criada.', isPremium: false, token });
    } else {
        const user = users[userIndex];
        
        if (!user.passwordHash) {
            user.passwordHash = hashPassword(password);
            saveDB();
            const token = generateAuthToken(key);
            return res.json({ success: true, message: 'Password definida.', isPremium: user.isPremium, token });
        }

        if (user.passwordHash === hashPassword(password)) {
            const token = generateAuthToken(key);
            return res.json({ success: true, message: 'Login efetuado.', isPremium: user.isPremium, token });
        } else {
            return res.status(401).json({ error: 'Password incorreta.' });
        }
    }
});

app.post('/api/admin/revoke-premium', (req, res) => {
    const { key, adminSecret } = req.body;
    
    if (adminSecret !== process.env.ADMIN_SECRET || 'EverTech2026Admin') {
        return res.status(403).json({ error: 'Acesso negado' });
    }
    
    const user = users.find(u => u.key === key);
    if (user) {
        user.isPremium = false;
        saveDB();
        return res.json({ success: true, message: `Premium removido para ${key}` });
    } else {
        return res.status(404).json({ error: 'Utilizador não encontrado' });
    }
});

// ==================== ROTAS PÚBLICAS ====================

app.get('/', (req, res) => {
    const userAgent = req.headers['user-agent'] || '';
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    if (req.query.file) {
        const fileId = req.query.file;
        const file = files.find(f => f.id === fileId);
        
        if (file && file.permission !== 'private') {
            const fileUrl = `https://${req.headers.host}/uploads/${file.filename}`;
            const mimeType = file.mimeType || 'application/octet-stream';
            const fileName = file.originalName || file.name || 'Ficheiro Partilhado';
            
            let metaTags = `
                <meta property="og:title" content="${fileName}">
                <meta property="og:description" content="Ficheiro partilhado via EverTech Cloud">
                <meta property="og:site_name" content="EverTech Cloud">
                <meta name="theme-color" content="#00e5ff">
            `;

            if (mimeType.startsWith('image/')) {
                metaTags += `
                    <meta property="og:type" content="image">
                    <meta property="og:image" content="${fileUrl}">
                    <meta name="twitter:card" content="summary_large_image">
                `;
            } else if (mimeType.startsWith('video/')) {
                metaTags += `
                    <meta property="og:type" content="video.other">
                    <meta property="og:video" content="${fileUrl}">
                    <meta property="og:video:type" content="${mimeType}">
                `;
            }
            
            html = html.replace('</head>', `${metaTags}</head>`);
        }
    }
    
    res.send(html);
});

// ==================== STRIPE ====================

app.post('/create-checkout-session', async (req, res) => {
    const { key } = req.body;
    
    try {
        const session = await stripe.checkout.sessions.create({
            ui_mode: 'embedded',
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'EverTech Cloud Premium',
                        description: 'Sem anúncios, uploads ilimitados',
                    },
                    unit_amount: 100,
                },
                quantity: 1,
            }],
            mode: 'payment',
            return_url: `${req.headers.origin}/return.html?session_id={CHECKOUT_SESSION_ID}&key=${key}`,
        });
        
        res.send({clientSecret: session.client_secret});
    } catch (e) {
        console.error("Stripe Error:", e.message);
        res.status(500).json({error: e.message});
    }
});

app.get('/session-status', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
        const userKey = req.query.key;

        if (session.status === 'complete' && userKey) {
             const userIndex = users.findIndex(u => u.key === userKey);
             const email = session.customer_details?.email;
             
             if (userIndex >= 0) {
                 users[userIndex].isPremium = true;
                 users[userIndex].email = email;
             } else {
                 users.push({ key: userKey, isPremium: true, email: email, createdAt: new Date() });
             }
             saveDB();
        }

        res.json({
            status: session.status,
            customer_email: session.customer_details?.email
        });
    } catch (e) {
        res.status(500).json({error: e.message});
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/checkout.html', (req, res) => res.sendFile(path.join(__dirname, 'checkout.html')));
app.get('/return.html', (req, res) => res.sendFile(path.join(__dirname, 'return.html')));
app.get('/checkout.js', (req, res) => res.sendFile(path.join(__dirname, 'checkout.js')));
app.get('/return.js', (req, res) => res.sendFile(path.join(__dirname, 'return.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));

// ==================== MIME TYPES ====================

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const types = {
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
        '.pdf': 'application/pdf', '.zip': 'application/zip'
    };
    return types[ext] || 'application/octet-stream';
}

// ==================== UPLOAD ====================

const uploadSessions = new Map();

app.post('/api/upload_chunk', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
    try {
        const { session_id, chunk_number, total_chunks, original_name, key, permission } = req.query;
        
        if (!session_id) {
            return res.status(400).json({ error: 'session_id é obrigatório' });
        }
        
        console.log(`📦 Chunk ${chunk_number}/${total_chunks} (session: ${session_id})`);
        
        if (!isUserPremium(key)) {
             const userFiles = files.filter(f => f.ownerKey === key);
             if (userFiles.length >= 5) {
                 return res.status(403).json({ error: 'Limite atingido. Ative Premium.' });
             }
        }

        if (!chunk_number || !total_chunks || !original_name || !req.body) {
            return res.status(400).json({ error: 'Dados inválidos' });
        }

        const chunkIndex = parseInt(chunk_number);
        const total = parseInt(total_chunks);
        const baseFilename = `upload_${session_id}`;
        const finalFilename = `${Date.now()}_${original_name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        
        if (chunkIndex === 1) {
            uploadSessions.set(session_id, {
                originalName: original_name,
                finalFilename: finalFilename,
                key: key,
                permission: permission,
                totalChunks: total,
                receivedChunks: new Set()
            });
        }
        
        const session = uploadSessions.get(session_id);
        if (!session) {
            return res.status(400).json({ error: 'Sessão inválida. Comece pelo chunk 1.' });
        }
        
        const tempPath = path.join(UPLOAD_DIR, `${baseFilename}.part${chunkIndex}`);
        const finalPath = path.join(UPLOAD_DIR, session.finalFilename);

        fs.writeFileSync(tempPath, req.body);
        session.receivedChunks.add(chunkIndex);
        
        if (session.receivedChunks.size === total) {
             console.log(`🔨 Reconstruindo: ${original_name}`);
             
             const chunks = [];
             for (let i = 1; i <= total; i++) {
                 const part = path.join(UPLOAD_DIR, `${baseFilename}.part${i}`);
                 if (fs.existsSync(part)) {
                     chunks.push(fs.readFileSync(part));
                 }
             }
             
             const finalBuffer = Buffer.concat(chunks);
             fs.writeFileSync(finalPath, finalBuffer);
             
             // Limpar chunks
             for (let i = 1; i <= total; i++) {
                 const part = path.join(UPLOAD_DIR, `${baseFilename}.part${i}`);
                 try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch(e) {}
             }
             
             const finalSize = fs.statSync(finalPath).size;
             const detectedMimeType = getMimeType(original_name);
             
             const newFile = {
                 id: Date.now().toString(),
                 filename: session.finalFilename,
                 originalName: original_name,
                 ownerKey: key,
                 permission: permission || 'view',
                 size: finalSize,
                 mimeType: detectedMimeType,
                 uploadDate: new Date()
             };
             
             files.push(newFile);
             saveDB();
             uploadSessions.delete(session_id);
             
             console.log(`✅ Upload completo: ${original_name} (${(finalSize / 1024 / 1024).toFixed(2)} MB)`);
             
             return res.json({ success: true, message: 'Upload completo', file: { id: newFile.id, size: finalSize } });
        }

        res.json({ success: true, message: `Chunk ${chunkIndex}/${total} recebido` });

    } catch (error) {
        console.error("❌ Erro no upload:", error);
        res.status(500).json({ error: 'Falha no servidor', details: error.message });
    }
});

// ==================== API ====================

app.get('/api/files', (req, res) => {
    const userKey = verifyAuth(req);
    if (!userKey) return res.status(401).json({ error: 'Não autenticado' });
    res.json(files.filter(f => f.ownerKey === userKey));
});

app.get('/api/user-status', (req, res) => {
    const key = req.query.key;
    res.json({ isPremium: isUserPremium(key) });
});

// CONTROLE DE ACESSO PARA ARQUIVOS PRIVADOS
app.get('/api/files/:id', (req, res) => {
    const f = files.find(x => x.id === req.params.id);
    if (!f) return res.status(404).json({ error: 'Ficheiro não encontrado' });
    
    // Se ficheiro é privado, exigir autenticação
    if (f.permission === 'private') {
        const userKey = verifyAuth(req);
        
        if (!userKey || userKey !== f.ownerKey) {
            return res.status(403).json({ 
                error: 'Acesso negado',
                requiresAuth: true,
                message: 'Este ficheiro é privado. Apenas o dono pode aceder.'
            });
        }
    }
    
    const publicData = {
        id: f.id,
        name: f.originalName || f.name,
        originalName: f.originalName,
        size: f.size,
        mimeType: f.mimeType,
        type: f.mimeType,
        uploadDate: f.uploadDate,
        permission: f.permission || 'view',
        url: `/uploads/${f.filename}`,
        filename: f.filename
    };
    
    res.json(publicData);
});

app.delete('/api/files/:id', (req, res) => {
    const key = verifyAuth(req);
    const idx = files.findIndex(f => f.id === req.params.id);
    if(idx === -1) return res.status(404).json({ error: 'Ficheiro não encontrado' });
    if(files[idx].ownerKey !== key) return res.status(403).json({ error: 'Sem permissão' });
    
    try { 
        fs.unlinkSync(path.join(UPLOAD_DIR, files[idx].filename));
    } catch(e) {
        console.error('Erro ao apagar:', e);
    }
    
    files.splice(idx, 1);
    saveDB();
    res.json({success: true});
});

// ==================== CLEANUP AUTOMÁTICO ====================

// Limpar chunks órfãos a cada hora
setInterval(() => {
    try {
        const uploadFiles = fs.readdirSync(UPLOAD_DIR);
        const now = Date.now();
        
        uploadFiles.forEach(file => {
            if (file.includes('.part')) {
                const filePath = path.join(UPLOAD_DIR, file);
                const stats = fs.statSync(filePath);
                const ageHours = (now - stats.mtimeMs) / (1000 * 60 * 60);
                
                if (ageHours > 1) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Chunk órfão removido: ${file}`);
                }
            }
        });
    } catch(e) {
        console.error('Erro no cleanup:', e);
    }
}, 60 * 60 * 1000);

// ==================== START SERVER ====================

if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    const credentials = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
    };
    https.createServer(credentials, app).listen(HTTPS_PORT, () => {
        console.log(`✅ Worker ${process.pid} - HTTPS em https://localhost:${HTTPS_PORT}`);
    });
    
    http.createServer((req, res) => {
        res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
        res.end();
    }).listen(HTTP_PORT);
    
} else {
    app.listen(HTTP_PORT, () => {
        console.log(`✅ Worker ${process.pid} - HTTP em http://localhost:${HTTP_PORT}`);
        console.warn('⚠️ Modo desenvolvimento - SSL não encontrado');
    });
}

} // End startServer
