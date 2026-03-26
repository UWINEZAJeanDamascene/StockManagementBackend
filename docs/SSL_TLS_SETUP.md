# =============================================================================
# SSL/TLS Setup Guide - Let's Encrypt
# =============================================================================
# This guide covers setting up HTTPS using Let's Encrypt (free)
# =============================================================================

## Prerequisites

1. Domain pointing to your server (e.g., `staging.yourdomain.com`)
2. Nginx installed on server
3. Server accessible on ports 80 and 443

---

## Option 1: Automated (Recommended)

### Using Certbot

```bash
# Install Certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Obtain certificate (for staging)
sudo certbot --nginx -d staging.yourdomain.com

# For production (with wildcard)
sudo certbot --nginx -d yourdomain.com -d *.yourdomain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

---

## Option 2: Manual Certificate

```bash
# Generate certificate
sudo certbot certonly --webroot -w /var/www/html -d staging.yourdomain.com

# Certificates will be stored in:
# /etc/letsencrypt/live/staging.yourdomain.com/
```

---

## Nginx Configuration Update

After obtaining certificates, update your nginx staging config:

```nginx
server {
    listen 443 ssl http2;
    server_name staging.yourdomain.com;

    # SSL Certificate
    ssl_certificate /etc/letsencrypt/live/staging.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.yourdomain.com/privkey.pem;

    # SSL Configuration (modern)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # HSTS (uncomment after testing)
    # add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Your proxy configuration
    location / {
        proxy_pass http://stock_staging;
        ...
    }
}

# HTTP to HTTPS redirect (uncomment after testing)
server {
    listen 80;
    server_name staging.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

---

## Auto-Renewal Setup

Let's Encrypt certificates expire after 90 days. Setup auto-renewal:

```bash
# Add to crontab
sudo crontab -e

# Add this line (runs twice daily)
0 0,12 * * * certbot renew --quiet --deploy-hook "nginx -s reload"
```

Or use systemd timer:

```bash
sudo systemctl list-timers | grep certbot
```

---

## Production SSL Configuration

For production, use these nginx SSL settings:

```nginx
# Stronger ciphers
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';

# OCSP Stapling
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 5s;
```

---

## Verify SSL Setup

```bash
# Test with SSL Labs
# Visit: https://www.ssllabs.com/ssltest/analyze.html?d=staging.yourdomain.com

# Or use openssl
openssl s_client -connect staging.yourdomain.com:443 -servername staging.yourdomain.com

# Check certificate details
openssl x509 -in /etc/letsencrypt/live/staging.yourdomain.com/cert.pem -text -noout
```

---

## Troubleshooting

### "Certificate not found"
- Check certificate path in nginx config
- Ensure `/etc/letsencrypt/live/` exists

### "SSL handshake failed"
- Check firewall: `sudo ufw status`
- Ensure port 443 is open

### "Domain not pointing here"
- Check DNS: `nslookup staging.yourdomain.com`
- Wait for DNS propagation (up to 48 hours)

---

## Quick Commands

| Command | Description |
|---------|-------------|
| `sudo certbot --nginx -d staging.yourdomain.com` | Get certificate |
| `sudo certbot renew --dry-run` | Test renewal |
| `sudo certbot certificates` | List certificates |
| `sudo certbot delete --cert-name staging.yourdomain.com` | Delete certificate |