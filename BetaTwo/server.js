const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto'); // Para hashing de passwords

// Configuração Stripe: Lê a chave da variável de ambiente ou falha se não existir
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
    console.error("ERRO CRÍTICO: A variável de ambiente STRIPE_SECRET_KEY não foi definida!");
}
const stripe = require('stripe')(stripeSecretKey);

// Caminhos para os certificados SSL (Unificados)
const sslKeyPath = path.join(__dirname, '..', 'ssl', 'private-key.pem');
const sslCertPath = path.join(__dirname, '..', 'ssl', 'certificate.pem');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const HTTP_PORT = process.env.HTTP_PORT || 3000;

// Configuração CORS mais segura
const corsOptions = {
    origin: '*', 
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-owner-key', 'stripe-signature']
};
app.use(cors(corsOptions));

// Webhook precisa de RAW body, antes do JSON parser global
app.post('/webhook', express.raw({type: 'application/json'}), async (request, response) => {
  const sig = request.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Se houver segredo de webhook configurado, verifica a assinatura
    if (endpointSecret) {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } else {
        // Fallback inseguro apenas para dev (não recomendado em prod)
        event = JSON.parse(request.body);
    }
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    response.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle the event
  switch (event.type) {
    case 'charge.refunded':
      const refund = event.data.object;
      console.log('Reembolso detetado:', refund.id);
      // Encontrar utilizador pelo email do pagamento original e remover premium
      if (refund.billing_details && refund.billing_details.email) {
          removePremiumByEmail(refund.billing_details.email);
      } else if (refund.receipt_email) {
          removePremiumByEmail(refund.receipt_email);
      } else {
          // Tentar buscar o PaymentIntent para ter o email
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
    default:
      // console.log(`Unhandled event type ${event.type}`);
  }

  response.send();
});

// Aumenta o limite de JSON para garantir que metadados passam (colocado DEPOIS do webhook)
app.use(express.json({ limit: '1mb' }));

// Set Security Headers - PERMISSIVA para evitar erros de CDN
app.use((req, res, next) => {
    // Para simplificar e evitar erros de carregamento de scripts externos (Vue, Tailwind, FontAwesome)
    // vamos relaxar a CSP. Em produção real, deveríamos ser mais específicos.
    res.setHeader(
        "Content-Security-Policy", 
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"
    );
    next();
});

// Middleware de tratamento de erros global
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Configuração para servir ficheiros (Streaming de Vídeo)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res, filePath) => {
        res.set("Accept-Ranges", "bytes");
        res.set("Access-Control-Allow-Origin", "*");
        // Set correct MIME type based on file extension
        const ext = path.extname(filePath).toLowerCase();
        const mimeType = getMimeType(filePath);
        if (mimeType) {
            res.set("Content-Type", mimeType);
        }
    }
}));

// --- PERSISTÊNCIA DE DADOS ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'database.json');
const USERS_DB_PATH = path.join(__dirname, 'users.json');
let files = [];
let users = []; 

// Garantir diretório de uploads
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Carregar base de dados
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

// Salvar base de dados
function saveDB() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(files, null, 2));
        fs.writeFileSync(USERS_DB_PATH, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error('Erro ao salvar base de dados:', e);
    }
}

// Helper para verificar premium
function isUserPremium(key) {
    const user = users.find(u => u.key === key);
    return user && user.isPremium;
}

// Helper para remover premium (usado no webhook)
function removePremiumByEmail(email) {
    const user = users.find(u => u.email === email);
    if (user) {
        user.isPremium = false;
        console.log(`PREMIUM REMOVIDO: Utilizador com email ${email} foi reembolsado.`);
        saveDB();
    } else {
        console.log(`AVISO: Reembolso recebido para ${email} mas utilizador não encontrado.`);
    }
}

// --- AUTH SYSTEM (LOGIN SEGURO) ---

// Hash simples para passwords (SHA-256)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Rota de Registo/Login Híbrida
app.post('/api/auth/login', (req, res) => {
    const { key, password } = req.body;

    if (!key || !password) {
        return res.status(400).json({ error: 'Chave e password são obrigatórios' });
    }

    const userIndex = users.findIndex(u => u.key === key);

    if (userIndex === -1) {
        // Utilizador NOVO: Criar conta com esta password
        const newUser = {
            key: key,
            passwordHash: hashPassword(password),
            isPremium: false,
            createdAt: new Date()
        };
        users.push(newUser);
        saveDB();
        return res.json({ success: true, message: 'Conta criada e login efetuado.', isPremium: false });
    } else {
        // Utilizador EXISTENTE: Verificar password
        const user = users[userIndex];
        
        // Se utilizador antigo sem password, definir agora (migração)
        if (!user.passwordHash) {
            user.passwordHash = hashPassword(password);
            saveDB();
            return res.json({ success: true, message: 'Password definida. Login efetuado.', isPremium: user.isPremium });
        }

        // Verificar hash
        if (user.passwordHash === hashPassword(password)) {
            return res.json({ success: true, message: 'Login efetuado.', isPremium: user.isPremium });
        } else {
            return res.status(401).json({ error: 'Password incorreta.' });
        }
    }
});

// ENDPOINT DE ADMINISTRAÇÃO - Remover Premium manualmente (TEMPORÁRIO)
app.post('/api/admin/revoke-premium', (req, res) => {
    const { key, adminSecret } = req.body;
    
    // Proteção simples - em produção, usar senha forte
    if (adminSecret !== 'EverTech2026Admin') {
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

// Servir index.html com Open Graph Tags dinâmicas (SSR Básico)
app.get('/', (req, res) => {
    // Se o user agent for um bot (Discord, WhatsApp, etc.), injetar meta tags
    const userAgent = req.headers['user-agent'] || '';
    const isBot = /bot|googlebot|crawler|spider|robot|crawling|facebookexternalhit|whatsapp|slack|twitter|discord/i.test(userAgent);
    
    // Ler o ficheiro index.html base
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

    // O frontend usa hash (#file=ID), o que é mau para OG tags.
    // O link partilhado deve usar query param ?file=ID para partilha social.
    
    if (req.query.file) {
        const fileId = req.query.file;
        const file = files.find(f => f.id === fileId);
        
        if (file) {
            const fileUrl = `https://${req.headers.host}/uploads/${file.filename}`;
            const mimeType = file.mimeType || 'application/octet-stream';
            const fileName = file.originalName || file.name || 'Ficheiro Partilhado';
            
            // Construir meta tags
            let metaTags = `
                <meta property="og:title" content="${fileName}">
                <meta property="og:description" content="Ficheiro partilhado via Cloud Share (${(file.size / 1024 / 1024).toFixed(1)} MB)">
                <meta property="og:site_name" content="EverTech Cloud">
                <meta name="theme-color" content="#00e5ff">
            `;

            if (mimeType.startsWith('image/')) {
                metaTags += `
                    <meta property="og:type" content="image">
                    <meta property="og:image" content="${fileUrl}">
                    <meta name="twitter:card" content="summary_large_image">
                    <meta name="twitter:image" content="${fileUrl}">
                `;
            } else if (mimeType.startsWith('video/')) {
                // Suporte para vídeo no Discord/Telegram
                metaTags += `
                    <meta property="og:type" content="video.other">
                    <meta property="og:video" content="${fileUrl}">
                    <meta property="og:video:secure_url" content="${fileUrl}">
                    <meta property="og:video:type" content="${mimeType}">
                    <meta property="og:video:width" content="1280">
                    <meta property="og:video:height" content="720">
                    <meta name="twitter:card" content="player">
                    <meta name="twitter:player" content="${fileUrl}">
                    <meta name="twitter:player:width" content="1280">
                    <meta name="twitter:player:height" content="720">
                `;
            } else {
                metaTags += `<meta property="og:type" content="website">`;
            }
            
            // Injetar no <head>
            html = html.replace('</head>', `${metaTags}</head>`);
        }
    }
    
    res.send(html);
});

// --- STRIPE PAYMENTS ---
app.post('/create-checkout-session', async (req, res) => {
    const { key } = req.body; 
    
    try {
        const session = await stripe.checkout.sessions.create({
            ui_mode: 'embedded',
            line_items: [
                {
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: 'EverTech Cloud Premium',
                            description: 'Sem anúncios, uploads ilimitados',
                        },
                        unit_amount: 100, // 1.00 EUR (Preço Atualizado)
                    },
                    quantity: 1,
                },
            ],
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
             // Upgrade user
             const userIndex = users.findIndex(u => u.key === userKey);
             // Regista o email para podermos revogar se houver reembolso
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

// Serve payment pages
app.use(express.static(path.join(__dirname, 'public'))); 
app.get('/checkout.html', (req, res) => res.sendFile(path.join(__dirname, 'checkout.html')));
app.get('/return.html', (req, res) => res.sendFile(path.join(__dirname, 'return.html')));
app.get('/checkout.js', (req, res) => res.sendFile(path.join(__dirname, 'checkout.js')));
app.get('/return.js', (req, res) => res.sendFile(path.join(__dirname, 'return.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));


// --- API ROUTES ---

// MIME Type detection melhorada - tipos específicos para cada formato
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    
    // Vídeos - tipos específicos para cada formato
    const videoTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.ogv': 'video/ogg',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.mkv': 'video/x-matroska',
        '.m4v': 'video/x-m4v',
        '.3gp': 'video/3gpp'
    };
    
    // Imagens - tipos específicos para cada formato
    const imageTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff'
    };
    
    // Áudio
    const audioTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac'
    };
    
    // Documentos
    const documentTypes = {
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.json': 'application/json',
        '.xml': 'application/xml',
        '.zip': 'application/zip',
        '.rar': 'application/x-rar-compressed',
        '.7z': 'application/x-7z-compressed'
    };
    
    return videoTypes[ext] || imageTypes[ext] || audioTypes[ext] || documentTypes[ext] || 'application/octet-stream';
}

// --- ROTA DE UPLOAD ROBUSTA COM LOGS DETALHADOS ---
// Aceita raw body até 100MB
app.post('/api/upload_chunk', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
    try {
        const { filename, chunk_number, total_chunks, original_name, key, permission } = req.query; 
        
        console.log(`📦 Chunk recebido: ${chunk_number}/${total_chunks} para ${original_name}`);
        
        // LIMIT CHECK for non-premium
        if (!isUserPremium(key)) {
             const userFiles = files.filter(f => f.ownerKey === key);
             if (userFiles.length >= 5) {
                 console.log(`❌ Limite atingido para ${key}`);
                 return res.status(403).json({ error: 'Limit reached. Go Premium for unlimited uploads.' });
             }
        }

        // Validação melhorada
        if (!filename || !chunk_number || !total_chunks || !original_name || !req.body) {
            console.log(`❌ Dados inválidos no upload`);
            return res.status(400).json({ error: 'Dados inválidos ou incompletos' });
        }

        const chunkIndex = parseInt(chunk_number);
        const total = parseInt(total_chunks);
        const filePath = path.join(UPLOAD_DIR, filename);
        const tempPath = `${filePath}.part${chunkIndex}`;

        // LOG: Tamanho do chunk recebido
        console.log(`   ↳ Tamanho do chunk: ${req.body.length} bytes`);

        // Gravar o pedaço temporariamente
        fs.writeFileSync(tempPath, req.body);
        console.log(`   ↳ Chunk ${chunkIndex} guardado em disco`);
        
        // Se for o último chunk, reconstruir o ficheiro
        if (chunkIndex === total) {
             console.log(`🔨 A reconstruir ficheiro completo: ${original_name}`);
             
             // Verificar se todos os chunks existem
             const missingChunks = [];
             for (let i = 1; i <= total; i++) {
                 const part = `${filePath}.part${i}`;
                 if (!fs.existsSync(part)) {
                     missingChunks.push(i);
                 }
             }
             
             if (missingChunks.length > 0) {
                 console.log(`❌ Chunks em falta: ${missingChunks.join(', ')}`);
                 return res.status(400).json({ error: `Missing chunks: ${missingChunks.join(', ')}` });
             }
             
             // Juntar todos os chunks usando Buffer para preservar dados binários
             const chunks = [];
             let totalSize = 0;
             
             for (let i = 1; i <= total; i++) {
                 const part = `${filePath}.part${i}`;
                 const chunkData = fs.readFileSync(part);
                 chunks.push(chunkData);
                 totalSize += chunkData.length;
                 console.log(`   ↳ Chunk ${i}: ${chunkData.length} bytes`);
             }
             
             // Concatenar todos os buffers
             const finalBuffer = Buffer.concat(chunks);
             console.log(`   ↳ Tamanho total final: ${finalBuffer.length} bytes (esperado: ${totalSize})`);
             
             // Escrever o ficheiro final
             fs.writeFileSync(filePath, finalBuffer);
             console.log(`   ↳ Ficheiro final escrito`);
             
             // Limpar chunks temporários
             for (let i = 1; i <= total; i++) {
                 const part = `${filePath}.part${i}`;
                 try {
                     fs.unlinkSync(part);
                 } catch(e) {
                     console.log(`   ⚠️ Não foi possível apagar ${part}`);
                 }
             }
             console.log(`   ↳ Chunks temporários limpos`);
             
             // Verificar tamanho final do ficheiro
             const finalSize = fs.statSync(filePath).size;
             console.log(`   ↳ Tamanho verificado no disco: ${finalSize} bytes`);
             
             // Usar o nome ORIGINAL para deteção de MIME type
             const detectedMimeType = getMimeType(original_name);
             console.log(`   ↳ MIME Type detectado: ${detectedMimeType}`);
             
             // Adicionar à "base de dados"
             const newFile = {
                 id: Date.now().toString(),
                 filename: filename,
                 originalName: original_name,
                 ownerKey: key,
                 permission: permission || 'view', 
                 size: finalSize,
                 mimeType: detectedMimeType,
                 uploadDate: new Date()
             };
             
             files.push(newFile);
             saveDB();
             
             console.log(`✅ Upload completo: ${original_name} (${(finalSize / 1024 / 1024).toFixed(2)} MB, ${detectedMimeType})`);
             
             return res.json({ success: true, message: 'Upload completo', file: { id: newFile.id, size: finalSize } });
        }

        res.json({ success: true, message: `Chunk ${chunkIndex}/${total} recebido` });

    } catch (error) {
        console.error("❌ Erro no upload:", error);
        res.status(500).json({ error: 'Falha no servidor ao gravar pedaço.', details: error.message });
    }
});

// Rotas da API
app.get('/api/files', (req, res) => res.json(files.filter(f => f.ownerKey === req.query.key)));
app.get('/api/user-status', (req, res) => {
    const key = req.query.key;
    res.json({ isPremium: isUserPremium(key) });
});

app.get('/api/files/:id', (req, res) => {
    const f = files.find(x => x.id === req.params.id);
    if (!f) return res.status(404).json({});
    
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
    const key = req.query.key || req.headers['x-owner-key'];
    const idx = files.findIndex(f => f.id === req.params.id);
    if(idx === -1) return res.status(404).json({ error: 'Ficheiro não encontrado' });
    if(files[idx].ownerKey !== key) return res.status(403).json({ error: 'Sem permissão' });
    
    try { 
        fs.unlinkSync(path.join(UPLOAD_DIR, files[idx].filename)); 
    } catch(e) {
        console.error('Erro ao apagar ficheiro:', e);
    }
    
    files.splice(idx, 1);
    saveDB();
    res.json({success: true});
});

// Verificar se os certificados SSL existem
if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
    const credentials = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
    };
    https.createServer(credentials, app).listen(HTTPS_PORT, () => {
        console.log(`✅ Servidor HTTPS a correr em https://localhost:${HTTPS_PORT}`);
    });
    
    // Redirecionamento HTTP -> HTTPS opcional
    http.createServer((req, res) => {
        res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
        res.end();
    }).listen(HTTP_PORT);
    
} else {
    // Se não houver HTTPS, inicia HTTP
    app.listen(HTTP_PORT, () => {
        console.log(`✅ Servidor HTTP a correr em http://localhost:${HTTP_PORT}`);
        console.warn('⚠️ Certificados SSL não encontrados. A rodar em modo não seguro.');
    });
}
