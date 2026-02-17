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

// Configuração para servir ficheiros (Streaming de Vídeo)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    setHeaders: (res) => {
        res.set("Accept-Ranges", "bytes");
        res.set("Access-Control-Allow-Origin", "*");
    }
}));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// "Base de dados" simples
let files = [];
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

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
        const { filename, chunk_number, total_chunks, original_name, key } = req.query;
        
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
        // CORREÇÃO: chunkIndex é 1-based (vem do cliente como 1, 2, 3...)
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
             files.push({
                 id: Date.now().toString(),
                 filename: filename,
                 originalName: original_name,
                 ownerKey: key,
                 size: fs.statSync(filePath).size,
                 mimeType: getMimeType(filename),
                 uploadDate: new Date()
             });
             
             return res.json({ success: true, message: 'Upload completo', file: { id: files[files.length-1].id } });
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
    res.json({ ...publicData, url: `/uploads/${f.filename}` });
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
