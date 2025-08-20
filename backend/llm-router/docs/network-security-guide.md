# 🌐 Network Security Configuration Guide

## Overview

This guide documents the network security configuration for the privacy-focused LLM server architecture, covering both development and production environments.

## 🏗️ Architecture Summary

### Development Architecture
```
[Client] ←→ HTTPS/443 ←→ [Router Server] ←→ UNIX Socket ←→ [Inference Process]
                               ↑                              ↑
                         localhost only                  localhost:8001
```

### Production Architecture
```
[Client] ←→ HTTPS/443 ←→ [Router Server] ←→ WireGuard+mTLS ←→ [Inference Server(s)]
                               ↑                                      ↑
                         Public interface                    WireGuard private network
                                                                  (10.0.0.0/24)
```

## 🔧 Development Configuration

### Network Setup

- **Router ⇄ Inference**: UNIX domain socket at `/run/inference.sock`
- **Client ⇄ Router**: HTTPS on port 443
- **Security**: Process isolation, no network exposure for inference

### Firewall Rules

**Allowed Ports:**
- `22/tcp` - SSH (administrative access)
- `443/tcp` - HTTPS (client connections)

**Blocked Ports:**
- `8001/tcp` - Inference server (localhost-only binding)
- All other ports (default deny)

**Implementation:**
```bash
# Apply development firewall rules
./scripts/setup-firewall-dev.sh

# Verify configuration
./scripts/verify-network-config.sh
```

### Security Features

1. **UNIX Socket Communication**
   - File-based IPC (not network ports)
   - Process-level access control
   - No accidental external exposure
   - Permissions: 660 (owner+group read/write)

2. **Service Isolation**
   - Dedicated users: `inference` and `router`
   - Systemd sandboxing enabled
   - No new privileges, protected system directories

3. **Network Binding**
   - Inference server binds only to `127.0.0.1:8001`
   - No external network interface exposure

## 🏭 Production Configuration

### Network Setup

- **Router ⇄ Inference**: WireGuard VPN + mTLS
- **Client ⇄ Router**: HTTPS on port 443
- **Private Network**: 10.0.0.0/24 (WireGuard)
  - Router: 10.0.0.1
  - Inference: 10.0.0.2+

### WireGuard Configuration

**Setup:**
```bash
# On router server
sudo ./scripts/setup-wireguard-prod.sh
# Select: router

# On inference server(s)
sudo ./scripts/setup-wireguard-prod.sh
# Select: inference
```

**Security Benefits:**
- Encrypted tunnel between servers
- Authentication via public key cryptography
- Network isolation (private subnet only)
- Automatic connection keep-alive

### mTLS Configuration

**Certificate Management:**
```bash
# Generate CA and server certificates
sudo ./scripts/setup-mtls-certs.sh setup

# Verify certificates
sudo ./scripts/setup-mtls-certs.sh verify

# Renew certificates (automated monthly)
sudo ./scripts/setup-mtls-certs.sh generate <server> <ip>
```

**Certificate Structure:**
- **CA Certificate**: Self-signed root CA for the system
- **Server Certificates**: Signed by CA, include SAN for IP/DNS
- **Client Authentication**: Mutual TLS verification
- **Automatic Rotation**: Monthly expiration check and renewal

### Production Firewall Rules

**Router Server:**
```bash
# Allowed ports
22/tcp   - SSH
443/tcp  - HTTPS (client connections)
51820/udp - WireGuard

# Blocked ports
8001/tcp - Inference port (only via WireGuard)
```

**Inference Server:**
```bash
# Allowed ports
22/tcp    - SSH
51820/udp - WireGuard

# Restricted access
8001/tcp  - Only from WireGuard network (10.0.0.0/24)
```

## 🔐 Security Controls

### Network Layer Security

1. **Encryption in Transit**
   - Client ↔ Router: TLS 1.3 (HTTPS)
   - Router ↔ Inference: WireGuard + mTLS (production)
   - Router ↔ Inference: UNIX socket (development)

2. **Authentication**
   - Client: HPKE public key authentication
   - Router ↔ Inference: mTLS mutual authentication
   - WireGuard: Public key cryptography

3. **Network Isolation**
   - Development: Process isolation via UNIX sockets
   - Production: Network isolation via private WireGuard tunnel
   - No direct inference server exposure

### Access Control

1. **Port Restrictions**
   - Minimal open ports (22, 443, 51820 for WG)
   - Inference port blocked from external access
   - Default deny firewall policy

2. **Service Binding**
   - Development: localhost-only binding (127.0.0.1)
   - Production: WireGuard interface binding (10.0.0.x)
   - No wildcard (0.0.0.0) binding

3. **User Isolation**
   - Dedicated service accounts
   - No root execution
   - Restricted file system access

## 🧪 Testing & Verification

### Development Testing
```bash
# Test UNIX socket connectivity
curl --unix-socket /run/inference.sock http://localhost/health

# Verify firewall rules
./scripts/verify-network-config.sh

# Test external access blocking
curl -m 5 http://your-server:8001  # Should fail/timeout
```

### Production Testing
```bash
# Test WireGuard connectivity
ping 10.0.0.1  # From inference server
ping 10.0.0.2  # From router server

# Test mTLS connection
openssl s_client -connect 10.0.0.2:8001 \
  -cert /etc/llm-router/certs/router-cert.pem \
  -key /etc/llm-router/certs/router-key.pem \
  -CAfile /etc/llm-router/ca/ca-cert.pem

# Verify certificate chain
openssl verify -CAfile /etc/llm-router/ca/ca-cert.pem \
  /etc/llm-router/certs/inference-cert.pem
```

## 📋 Deployment Checklist

### Development Deployment
- [ ] UNIX socket services configured and running
- [ ] Firewall rules applied (SSH/HTTPS only)
- [ ] Inference port blocked from external access
- [ ] Service isolation verified (dedicated users)
- [ ] Network configuration tests passing

### Production Deployment

**Initial Setup:**
- [ ] WireGuard configured on all servers
- [ ] mTLS certificates generated and distributed
- [ ] Firewall rules applied per server role
- [ ] Services configured for production binding
- [ ] Certificate rotation scheduled

**Ongoing Operations:**
- [ ] WireGuard tunnel connectivity monitored
- [ ] Certificate expiration alerts configured
- [ ] Security updates automated
- [ ] Network access logs reviewed
- [ ] Firewall rules audited regularly

## 🚨 Security Incidents

### Network Compromise Response

1. **Immediate Actions**
   - Isolate affected servers from network
   - Revoke and regenerate all certificates
   - Rotate WireGuard keys
   - Review access logs

2. **Recovery Steps**
   - Rebuild servers with updated security
   - Implement additional monitoring
   - Update firewall rules if needed
   - Coordinate with incident response team

### Certificate Compromise

1. **Revocation**
   - Generate new CA if CA key compromised
   - Revoke and replace all server certificates
   - Update certificate distribution

2. **Prevention**
   - Implement hardware security modules (HSMs)
   - Enable certificate transparency logging
   - Increase certificate rotation frequency

## 🔄 Maintenance Procedures

### Regular Maintenance (Weekly)
- Review network access logs
- Verify service health and connectivity
- Check certificate expiration dates
- Update security patches

### Periodic Maintenance (Monthly)
- Rotate certificates (automated)
- Review firewall rule effectiveness
- Test disaster recovery procedures
- Audit user access and permissions

### Annual Reviews
- Security architecture assessment
- Penetration testing
- Compliance audit
- Emergency response plan testing

---

## 📚 References

- **WireGuard Documentation**: https://www.wireguard.com/
- **mTLS Best Practices**: RFC 8705
- **UNIX Domain Sockets**: `man 7 unix`
- **Systemd Security**: `man 5 systemd.exec`
- **iptables/pfctl**: Platform-specific firewall documentation

---

*Last updated: 2025-08-20*  
*Configuration version: Development v1.0, Production v1.0*