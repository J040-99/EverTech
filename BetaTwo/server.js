const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
// Aumenta o limite de JSON para garantir que metadados passam
app.use(express.json({ limit: '1mb' }));

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

// --- ROTA DE UPLOAD ROBUSTA ---
// Aceita raw body até 100MB (embora usemos 5MB no frontend)
app.post('/api/upload_chunk', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
    try {
        const { filename, chunk_number, total_chunks, original_name, key, permission } = req.query;
        
        if (!filename || !req.body) return res.status(400).json({ error: 'Dados inválidos' });

        const tempFilePath = path.join(UPLOAD_DIR, `temp_${filename}`);

        // Escreve o pedaço no disco de forma assíncrona (Append)
        await fs.promises.appendFile(tempFilePath, req.body);

        // Verifica se foi o último pedaço
        if (parseInt(chunk_number) === parseInt(total_chunks)) {
            const finalName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(original_name);
            const finalPath = path.join(UPLOAD_DIR, finalName);
            
            // Renomeia o ficheiro temporário para o final
            await fs.promises.rename(tempFilePath, finalPath);

            const fileData = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2),
                ownerKey: key || 'anonimo',
                name: original_name,
                type: getMimeType(original_name),
                filename: finalName,
                permission: permission || 'view',
                uploadDate: new Date().toISOString(),
                url: `/uploads/${finalName}`
            };
            files.push(fileData);
            
            console.log(`✅ Upload concluído: ${original_name} (${fileData.id})`);
            return res.json({ status: 'done', file: fileData });
        }

        res.json({ status: 'chunk_received', chunk: chunk_number });

    } catch (error) {
        console.error("Erro no upload:", error);
        res.status(500).json({ error: 'Falha no servidor ao gravar pedaço.' });
    }
});

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video/mp4'; // Força video/mp4 para tentar compatibilidade
    if (['.jpg', '.png', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image/jpeg';
    return 'application/octet-stream';
}

// Rotas da API
app.get('/api/files', (req, res) => res.json(files.filter(f => f.ownerKey === req.query.key)));
app.get('/api/files/:id', (req, res) => {
    const f = files.find(x => x.id === req.params.id);
    if (!f) return res.status(404).json({});
    const { ownerKey, ...public } = f;
    res.json(public);
});
app.delete('/api/files/:id', (req, res) => {
    const idx = files.findIndex(f => f.id === req.params.id);
    if(idx === -1 || files[idx].ownerKey !== req.body.key) return res.status(403).json({});
    try { fs.unlinkSync(path.join(UPLOAD_DIR, files[idx].filename)); } catch(e){}
    files.splice(idx, 1);
    res.json({success:true});
});

app.listen(PORT, () => console.log(`✅ Servidor Heavy-Duty ON: ${PORT}`));
