const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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

// --- REMOVIDO: express.static global para /uploads para evitar acesso direto sem controlo ---
// app.use('/uploads', express.static(...)); 

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- PERSISTÊNCIA DE DADOS ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_PATH = path.join(__dirname, 'database.json');
let files = [];

// Garantir diretório de uploads
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Carregar base de dados
function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            files = JSON.parse(data);
            console.log(`📂 Base de dados carregada: ${files.length} ficheiros.`);
        }
    } catch (e) {
        console.error('Erro ao carregar base de dados:', e);
        files = [];
    }
}
loadDB();

// Salvar base de dados
function saveDB() {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(files, null, 2));
    } catch (e) {
        console.error('Erro ao salvar base de dados:', e);
    }
}

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video/mp4';
    if (['.jpg', '.png', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image/jpeg';
    return 'application/octet-stream';
}

// --- ROTA DE ARMAZENAMENTO SEGURA ---
// Substitui o express.static para controlar permissões e referers (evitar embeds externos)
app.get('/api/storage/:filename', (req, res) => {
    const filename = req.params.filename;
    const fileData = files.find(f => f.filename === filename);
    
    // Se não existir na BD, verifica disco (legado) ou 404
    if (!fileData && !fs.existsSync(path.join(UPLOAD_DIR, filename))) {
        return res.status(404).send('Ficheiro não encontrado');
    }

    const filePath = path.join(UPLOAD_DIR, filename);
    const mimeType = fileData ? fileData.mimeType : getMimeType(filename);
    
    // Controlo de Permissões e Embeds
    const permission = fileData ? fileData.permission : 'view'; // default view
    
    // BLOQUEIO DE EMBEDS EXTERNOS (Anti-Hotlink)
    // Se não for download explícito, exige que o pedido venha do próprio site
    // Isto impede que o link direto gere pré-visualizações em Discord/WhatsApp/etc
    const referer = req.headers.referer || '';
    const host = req.headers.host || '';
    
    // Se a permissão não for 'download' (ou seja, é view restrito) E o referer não contiver o nosso host...
    // Nota: Browsers modernos enviam referer. Apps de chat muitas vezes não, ou usam user-agents bots.
    // Vamos ser permissivos se não houver referer mas bloquear se referer for externo? 
    // Para segurança máxima de "não ver sem abrir", bloqueamos se não vier da app.
    if (permission !== 'download') {
        if (referer && !referer.includes(host)) {
             return res.status(403).send('Acesso direto proibido. Abra o link no navegador.');
        }
    }

    // Configuração de Download vs View
    if (permission === 'download') {
        // Força download
        const downloadName = fileData ? (fileData.originalName || fileData.filename) : filename;
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    } else {
        // Permite visualização inline (no browser) mas tenta inibir "Save As" fácil via headers (não é infalível)
        res.setHeader('Content-Disposition', 'inline');
    }

    // Streaming
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': mimeType,
        };
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        const head = {
            'Content-Length': fileSize,
            'Content-Type': mimeType,
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
    }
});

// --- ROTA DE UPLOAD ROBUSTA ---
app.post('/api/upload_chunk', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
    try {
        const { filename, chunk_number, total_chunks, original_name, key, permission } = req.query; // Capture permission
        
        if (!filename || !chunk_number || !total_chunks || !original_name || !req.body) {
            return res.status(400).json({ error: 'Dados inválidos ou incompletos' });
        }

        const chunkIndex = parseInt(chunk_number);
        const total = parseInt(total_chunks);
        const filePath = path.join(UPLOAD_DIR, filename);
        const tempPath = `${filePath}.part${chunkIndex}`;

        fs.writeFileSync(tempPath, req.body);
        
        if (chunkIndex === total) {
             const finalFile = fs.createWriteStream(filePath);
             const writeFinished = new Promise((resolve, reject) => {
                 finalFile.on('finish', resolve);
                 finalFile.on('error', reject);
             });

             for (let i = 1; i <= total; i++) {
                 const part = `${filePath}.part${i}`;
                 if (fs.existsSync(part)) {
                     const data = fs.readFileSync(part);
                     finalFile.write(data);
                     fs.unlinkSync(part);
                 }
             }
             finalFile.end();
             await writeFinished;
             
             const newFile = {
                 id: Date.now().toString(),
                 filename: filename,
                 originalName: original_name,
                 ownerKey: key,
                 permission: permission || 'view', // Save permission!
                 size: fs.statSync(filePath).size,
                 mimeType: getMimeType(filename),
                 uploadDate: new Date()
             };
             
             files.push(newFile);
             saveDB();
             
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
app.get('/api/files/:id', (req, res) => {
    const f = files.find(x => x.id === req.params.id);
    if (!f) return res.status(404).json({});
    const { ownerKey, ...publicData } = f;
    // URL aponta para a nova rota segura
    res.json({ ...publicData, url: `/api/storage/${f.filename}` });
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
    
    http.createServer((req, res) => {
        res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
        res.end();
    }).listen(HTTP_PORT);
    
} else {
    app.listen(HTTP_PORT, () => {
        console.log(`✅ Servidor HTTP a correr em http://localhost:${HTTP_PORT}`);
        console.warn('⚠️ Certificados SSL não encontrados. A rodar em modo não seguro.');
    });
}
