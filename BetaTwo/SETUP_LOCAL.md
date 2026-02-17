# 🛠️ Setup Local - EverTech Cloud

## 📝 Configuração Rápida (5 minutos)

### 1. Instalar Dependências
```bash
cd BetaTwo
npm install
```

### 2. Criar Ficheiro .env
```bash
cp .env.example .env
```

Edita o ficheiro `.env` com as tuas credenciais:

```env
# Stripe (Obrigatório)
STRIPE_SECRET_KEY=sk_live_sua_chave_aqui
STRIPE_WEBHOOK_SECRET=whsec_seu_webhook_aqui

# Segurança
JWT_SECRET=gere_uma_string_aleatoria_aqui
ADMIN_SECRET=sua_senha_admin_secreta

# Ambiente
NODE_ENV=production
```

#### 🔑 Como Gerar JWT_SECRET Seguro

**Opção 1 - Windows PowerShell:**
```powershell
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | % {[char]$_})
```

**Opção 2 - Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Opção 3 - Online:**
https://randomkeygen.com/ (usar "Fort Knox Passwords")

---

### 3. Iniciar Vigilante

Duplo clique em `vigilante_simples.bat` ou:

```cmd
vigilante_simples.bat
```

**O vigilante agora:**
- ✅ Carrega automaticamente as variáveis do `.env`
- ✅ Verifica portas 3000 e 3443 (HTTP + HTTPS)
- ✅ Reinicia automaticamente em caso de crash
- ✅ Suporta modo cluster (produção)

---

## 🔍 Troubleshooting

### Erro: "Cannot find module 'dotenv'"
```bash
npm install dotenv
```

### Erro: "STRIPE_SECRET_KEY não definida"
1. Verifica se o ficheiro `.env` existe na pasta `BetaTwo/`
2. Confirma que o ficheiro contém `STRIPE_SECRET_KEY=sk_live_...`
3. Reinicia o vigilante

### Porta 3000 já em uso
O vigilante tenta automaticamente a porta 3443 (HTTPS) se o SSL estiver configurado.

---

## 🚀 Scripts Disponíveis

```bash
# Modo Desenvolvimento (com auto-reload)
npm run dev

# Modo Normal
npm start

# Modo Produção (com cluster)
npm run prod
```

---

## 🔒 Segurança

⚠️ **NUNCA commites o ficheiro `.env` para o GitHub!**

O ficheiro `.gitignore` já está configurado para ignorar `.env`, mas verifica sempre antes de fazer commit:

```bash
git status
```

Se vires `.env` na lista, adiciona ao `.gitignore`:

```bash
echo .env >> .gitignore
```

---

## 📊 Monitorização

O vigilante mostra no console:
- ✅ Status de cada serviço (OK/Reiniciando)
- 🔄 Verificações a cada 5 segundos
- 📦 Portas em uso

Mantém a janela minimizada - o vigilante continua ativo em background.

---

**Desenvolvido por EverTech © 2026**
