const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const stripe = require('stripe')('sk_test_51T1qYeLTrivMFSU9e4B04X2045504543504354350435'); // Use environment variable in production!

// Caminhos para os certificados SSL (Unificados)
const sslKeyPath = path.join(__dirname, '..', 'ssl', 'private-key.pem');
const sslCertPath = path.join(__dirname, '..', 'ssl', 'certificate.pem');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const HTTP_PORT = process.env.HTTP_PORT || 3000;

// Configuração CORS mais segura
const corsOptions = {
    origin: '*', // Idealmente, restringir para domínios específicos em produção
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-owner-key']
};
app.use(cors(corsOptions));

// Aumenta o limite de JSON para garantir que metadados passam
app.use(express.json({ limit: '1mb' }));

// Middleware de tratamento de erros global
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// Configuração para servir ficheiros (Streaming de Vídeo)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res) => {
        res.set("Accept-Ranges", "bytes");
        res.set("Access-Control-Allow-Origin", "*");
    }
}));

// --- PERSISTÊNCIA DE DADOS ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'database.json');
const USERS_DB_PATH = path.join(__dirname, 'users.json');
let files = [];
let users = []; // Simple users DB: { key: "...", isPremium: false }

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
    const { key } = req.body; // User key passed from frontend
    
    try {
        const session = await stripe.checkout.sessions.create({
            ui_mode: 'embedded',
            line_items: [
                {
                    // Provide the exact Price ID (for example, pr_1234) of the product you want to sell
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: 'EverTech Cloud Premium',
                            description: 'No ads, unlimited uploads',
                        },
                        unit_amount: 500, // 5.00 EUR
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            return_url: `${req.headers.origin}/return.html?session_id={CHECKOUT_SESSION_ID}&key=${key}`,
        });
        
        res.send({clientSecret: session.client_secret});
    } catch (e) {
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
             if (userIndex >= 0) {
                 users[userIndex].isPremium = true;
             } else {
                 users.push({ key: userKey, isPremium: true, email: session.customer_details.email });
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
app.use(express.static(path.join(__dirname, 'public'))); // Assuming payment files are here or serve individually
app.get('/checkout.html', (req, res) => res.sendFile(path.join(__dirname, 'checkout.html')));
app.get('/return.html', (req, res) => res.sendFile(path.join(__dirname, 'return.html')));
app.get('/checkout.js', (req, res) => res.sendFile(path.join(__dirname, 'checkout.js')));
app.get('/return.js', (req, res) => res.sendFile(path.join(__dirname, 'return.js')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));


// --- API ROUTES ---

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video/mp4';
    if (['.jpg', '.png', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image/jpeg';
    return 'application/octet-stream';
}

// --- ROTA DE UPLOAD ROBUSTA ---
// Aceita raw body até 100MB
app.post('/api/upload_chunk', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
    try {
        const { filename, chunk_number, total_chunks, original_name, key, permission } = req.query; 
        
        // LIMIT CHECK for non-premium
        if (!isUserPremium(key)) {
             const userFiles = files.filter(f => f.ownerKey === key);
             if (userFiles.length >= 5) { // Limit to 5 files for free users
                 return res.status(403).json({ error: 'Limit reached. Go Premium for unlimited uploads.' });
             }
        }

        // Validação melhorada
        if (!filename || !chunk_number || !total_chunks || !original_name || !req.body) {
            return res.status(400).json({ error: 'Dados inválidos ou incompletos' });
        }

        const chunkIndex = parseInt(chunk_number);
        const total = parseInt(total_chunks);
        const filePath = path.join(UPLOAD_DIR, filename);
        const tempPath = `${filePath}.part${chunkIndex}`;

        // Gravar o pedaço temporariamente
        fs.writeFileSync(tempPath, req.body);
        
        // Se for o último chunk, tentar reconstruir
        if (chunkIndex === total) {
             const finalFile = fs.createWriteStream(filePath);
             
             // Cria uma Promise para esperar que o writeStream termine
             const writeFinished = new Promise((resolve, reject) => {
                 finalFile.on('finish', resolve);
                 finalFile.on('error', reject);
             });

             // CORREÇÃO: Loop de 1 até total para apanhar as partes corretas
             for (let i = 1; i <= total; i++) {
                 const part = `${filePath}.part${i}`;
                 if (fs.existsSync(part)) {
                     const data = fs.readFileSync(part);
                     finalFile.write(data);
                     fs.unlinkSync(part); // Limpar chunks
                 }
             }
             finalFile.end();
             
             // Espera que o ficheiro esteja completamente escrito antes de obter stats
             await writeFinished;
             
             // Adicionar à "base de dados"
             const newFile = {
                 id: Date.now().toString(),
                 filename: filename,
                 originalName: original_name,
                 ownerKey: key,
                 permission: permission || 'view', 
                 size: fs.statSync(filePath).size,
                 mimeType: getMimeType(filename), 
                 uploadDate: new Date()
             };
             
             files.push(newFile);
             saveDB(); // Persistir mudança
             
             return res.json({ success: true, message: 'Upload completo', file: { id: newFile.id } });
        }

        res.json({ success: true, message: `Chunk ${chunkIndex} recebido` });

    } catch (error) {
        console.error("Erro no upload:", error);
        res.status(500).json({ error: 'Falha no servidor ao gravar pedaço.' });
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
        url: `/uploads/${f.filename}` 
    };
    
    res.json(publicData);
});
app.delete('/api/files/:id', (req, res) => {
    const key = req.query.key || req.headers['x-owner-key']; // Aceita query ou header
    const idx = files.findIndex(f => f.id === req.params.id);
    if(idx === -1) return res.status(404).json({ error: 'Ficheiro não encontrado' });
    if(files[idx].ownerKey !== key) return res.status(403).json({ error: 'Sem permissão' });
    
    try { 
        fs.unlinkSync(path.join(UPLOAD_DIR, files[idx].filename)); 
    } catch(e) {
        console.error('Erro ao apagar ficheiro:', e);
    }
    
    files.splice(idx, 1);
    saveDB(); // Persistir mudança
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
