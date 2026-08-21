# KM Check — Painel Administrativo

Dashboard privado para monitoramento do app KM Check. Só o administrador tem acesso.

## Funcionalidades

### 📱 Aba Dispositivos
- Lista todos os dispositivos que usam o app (pings anônimos)
- Plataforma (iOS/Android/Windows), versão do app, resolução da tela, IP
- Primeiro acesso e último ping de cada dispositivo
- Filtros por plataforma e busca por texto
- Estatísticas: total, por plataforma, ativos hoje/semana, versão mais usada
- Auto-refresh a cada 60 segundos

### 🗺️ Aba Cobertura SNV
- Rodovias disponíveis no KM Check vs catálogo completo do DNIT
- UF, BR, Código (B/A/N/C/U/V), versão SNV, KM total, segmentos
- Destaque visual das rodovias faltando (em vermelho)
- Sincronização do catálogo DNIT via WFS GeoServer (atualiza a referência)
- Cobertura em porcentagem
- Versões SNV processadas no servidor
- Filtros por UF, status (disponível/faltando) e busca

## Deploy no VPS (Contabo)

### 1. Copiar arquivos para o servidor

```bash
# Na sua máquina local
scp -r admin/ root@SEU_IP:/opt/kmcheck-admin/
```

### 2. Instalar dependências

```bash
ssh root@SEU_IP
cd /opt/kmcheck-admin
npm install
```

### 3. Configurar credenciais

```bash
cp .env.example .env

# Gerar hash da senha
npm run hash -- "SuaSenhaSegura123"
# Copie o hash que aparecer

# Gerar chave JWT
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# Editar o .env
nano .env
```

Preencha no `.env`:
```
ADMIN_PORT=3457
ADMIN_USER=admin
ADMIN_HASH=$2a$12$XXXXXXX   ← cole o hash aqui
JWT_SECRET=XXXXXXX            ← cole a chave JWT aqui
CONTROLCHECK_API=https://controlcheck.duckdns.org/api
```

### 4. Testar

```bash
node server.mjs
# Deve mostrar: 🔒 KM Check Admin rodando em http://localhost:3457
```

### 5. Configurar como serviço (systemd)

```bash
cat > /etc/systemd/system/kmcheck-admin.service << 'EOF'
[Unit]
Description=KM Check Admin Panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/kmcheck-admin
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kmcheck-admin
systemctl start kmcheck-admin
systemctl status kmcheck-admin
```

### 6. Configurar nginx (reverse proxy)

Adicione ao seu arquivo de configuração nginx do `controlcheck.duckdns.org`:

```nginx
# Painel admin — API + pings dos dispositivos
location /api/admin {
    proxy_pass http://127.0.0.1:3457;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

```bash
nginx -t && systemctl reload nginx
```

### 7. Acessar o painel

Acesse diretamente: `http://SEU_IP:3457`

Ou, se quiser acesso via domínio (recomendado — mais seguro com HTTPS):
1. Configure um subdomínio ou path no nginx
2. Exemplo: `https://controlcheck.duckdns.org:3457/`

## Notas

- O banco SQLite (`admin.db`) é criado automaticamente no primeiro uso
- Os pings dos dispositivos são recebidos em `/api/admin/devices/ping` — mesma URL que o app mobile já envia
- O botão "Sincronizar DNIT" na aba Cobertura faz uma consulta ao WFS GeoServer do DNIT para buscar o catálogo completo de rodovias — pode levar 1-2 minutos
- O JWT expira em 7 dias — depois disso pede login novamente
- Logs: `journalctl -u kmcheck-admin -f`

## Comandos úteis

```bash
# Ver logs em tempo real
journalctl -u kmcheck-admin -f

# Reiniciar o serviço
systemctl restart kmcheck-admin

# Ver status
systemctl status kmcheck-admin

# Trocar a senha
cd /opt/kmcheck-admin
npm run hash -- "NovaSenha456"
# Edite o .env com o novo hash
systemctl restart kmcheck-admin
```
