# EverTech Cloud - Guia de Produção

## 🚀 Otimizações Implementadas

### 1. **Cluster Mode (Multi-Core)**
- Usa todos os cores da CPU automaticamente em produção
- Restart automático de workers em caso de crash
- Escala horizontalmente com a capacidade do servidor

### 2. **Rate Limiting**
- **API Geral**: 100 requests/15min por IP
- **Uploads**: 50 uploads/hora por IP
- **Auth**: 10 tentativas/15min por IP
- Proteção contra DDoS e abuso

### 3. **Compressão GZIP**
- Reduz bandwidth em até 70%
- Compressão automática de respostas
- Menor tempo de carregamento

### 4. **Segurança (Helmet)**
- Headers HTTP seguros
- Proteção XSS
- Proteção CSRF
- Clickjacking protection

### 5. **Caching Inteligente**
- Cache de ficheiros estáticos (7 dias)
- ETags automáticos
- Conditional requests (304 Not Modified)
- CDN-ready

### 6. **Controle de Acesso**
- ✅ **Ficheiros Privados**: Apenas o dono pode aceder
- ✅ **Autenticação Obrigatória**: Token-based auth
- ✅ **Verificação de Proprietário**: Antes de servir ficheiros

### 7. **Cleanup Automático**
- Remove chunks órfãos a cada hora
- Previne acumulação de ficheiros temporários
- Liberta espaço automaticamente

### 8. **Logging em Produção**
- Morgan logging (formato Apache Combined)
- Rastreamento de requests
- Debug de problemas em produção

---

## 📚 Instalação

### 1. Instalar Dependências
```bash
cd BetaTwo
npm install
```

### 2. Configurar Variáveis de Ambiente
```bash
cp .env.example .env
nano .env  # Editar com as tuas credenciais
```

**Variáveis Obrigatórias:**
- `STRIPE_SECRET_KEY`: Chave secreta do Stripe
- `JWT_SECRET`: String aleatória para tokens (gerar com `openssl rand -hex 32`)
- `ADMIN_SECRET`: Password do admin

### 3. Instalar Pacotes Adicionais
```bash
npm install compression express-rate-limit helmet morgan
```

---

## 🛠️ Deploy em Produção

### Opção 1: PM2 (Recomendado)
```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar em modo cluster (usa todos os cores)
pm2 start server.js -i max --name "evertech-cloud"

# Ver logs
pm2 logs evertech-cloud

# Monitorizar
pm2 monit

# Restart
pm2 restart evertech-cloud

# Auto-start após reboot
pm2 startup
pm2 save
```

### Opção 2: Systemd (Linux)
```bash
sudo nano /etc/systemd/system/evertech.service
```

```ini
[Unit]
Description=EverTech Cloud
After=network.target

[Service]
Type=simple
User=seuusuario
WorkingDirectory=/caminho/para/BetaTwo
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable evertech
sudo systemctl start evertech
sudo systemctl status evertech
```

### Opção 3: Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000 3443
CMD ["npm", "run", "prod"]
```

```bash
docker build -t evertech-cloud .
docker run -d -p 3443:3443 -p 3000:3000 --name evertech evertech-cloud
```

---

## 🌐 Nginx Reverse Proxy

### Configuração Recomendada
```nginx
server {
    listen 80;
    listen [::]:80;
    server_name seudominio.com www.seudominio.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name seudominio.com www.seudominio.com;

    ssl_certificate /etc/letsencrypt/live/seudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/seudominio.com/privkey.pem;

    # Upload máximo
    client_max_body_size 100M;

    # Timeout para uploads grandes
    proxy_read_timeout 300;
    proxy_connect_timeout 300;
    proxy_send_timeout 300;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Cache de ficheiros estáticos
    location /uploads {
        proxy_pass http://localhost:3000/uploads;
        proxy_cache my_cache;
        proxy_cache_valid 200 7d;
        add_header X-Cache-Status $upstream_cache_status;
    }
}
```

### Instalar Certbot (SSL Grátis)
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com -d www.seudominio.com
```

---

## 📊 Monitorização

### Logs
```bash
# PM2
pm2 logs evertech-cloud --lines 100

# Systemd
sudo journalctl -u evertech -f

# Docker
docker logs -f evertech
```

### Métricas
```bash
# PM2 Monitor
pm2 monit

# Stats
pm2 info evertech-cloud
```

---

## ⚡ Performance Tips

### 1. Base de Dados Dedicada
Para grande escala, migrar de JSON para:
- **PostgreSQL** (melhor para dados relacionais)
- **MongoDB** (melhor para ficheiros grandes)
- **Redis** (para cache e sessões)

### 2. Storage Externo
- **AWS S3**: Armazenamento escalável
- **Cloudflare R2**: Sem custos de egress
- **Backblaze B2**: Custo baixo

### 3. CDN
- **Cloudflare**: Grátis, DDoS protection
- **AWS CloudFront**: Integração S3
- **BunnyCDN**: Custo baixo, rápido

### 4. Load Balancer
```bash
# Nginx upstream
upstream evertech_backend {
    least_conn;
    server localhost:3001;
    server localhost:3002;
    server localhost:3003;
}
```

---

## 🔒 Segurança Adicional

### 1. Firewall
```bash
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

### 2. Fail2Ban (Proteção contra Brute Force)
```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
```

### 3. Backup Automático
```bash
# Cron job diário
0 2 * * * tar -czf /backup/evertech-$(date +\%Y\%m\%d).tar.gz /caminho/para/BetaTwo/uploads /caminho/para/BetaTwo/*.json
```

---

## 📝 Checklist de Deploy

- [ ] Variáveis de ambiente configuradas
- [ ] SSL/HTTPS ativo
- [ ] Nginx/reverse proxy configurado
- [ ] PM2 ou systemd a correr
- [ ] Firewall configurado
- [ ] Backups automáticos
- [ ] Monitorização ativa
- [ ] Logs a funcionar
- [ ] Testar uploads grandes
- [ ] Testar ficheiros privados
- [ ] Rate limiting verificado
- [ ] Webhook do Stripe configurado

---

## 🌟 Recursos Adicionais

- [Express Production Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)
- [Node.js Security Checklist](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Nginx Optimization](https://www.nginx.com/blog/tuning-nginx/)

---

**Desenvolvido por EverTech © 2026**
