#!/bin/bash

# mTLS Certificate Management for Production
# Creates and manages certificates for router-inference communication

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration
CA_DIR="/etc/llm-router/ca"
CERTS_DIR="/etc/llm-router/certs"
CA_KEY="$CA_DIR/ca-key.pem"
CA_CERT="$CA_DIR/ca-cert.pem"

echo "🔐 Setting up mTLS Certificates for Production"
echo "=============================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    echo "❌ This script must be run as root for certificate management"
    echo "Please run: sudo $0 $*"
    exit 1
fi

# Create directories
create_directories() {
    echo "📁 Creating certificate directories..."
    mkdir -p "$CA_DIR" "$CERTS_DIR"
    chmod 700 "$CA_DIR" "$CERTS_DIR"
}

# Generate CA certificate
generate_ca() {
    if [[ -f "$CA_CERT" ]]; then
        echo "ℹ️  CA certificate already exists: $CA_CERT"
        return
    fi
    
    echo "🏛️  Generating Certificate Authority..."
    
    # Create CA private key
    openssl genrsa -out "$CA_KEY" 4096
    chmod 600 "$CA_KEY"
    
    # Create CA certificate
    openssl req -new -x509 -days 3650 -key "$CA_KEY" -out "$CA_CERT" \
        -subj "/C=US/ST=CA/L=SF/O=LLM-Router/OU=CA/CN=LLM-Router-CA"
    chmod 644 "$CA_CERT"
    
    echo "✅ CA certificate generated: $CA_CERT"
}

# Generate server certificate
generate_server_cert() {
    local server_name="$1"
    local server_ip="$2"
    local cert_key="$CERTS_DIR/${server_name}-key.pem"
    local cert_csr="$CERTS_DIR/${server_name}.csr"
    local cert_file="$CERTS_DIR/${server_name}-cert.pem"
    local cert_config="$CERTS_DIR/${server_name}.conf"
    
    echo "🔑 Generating certificate for $server_name ($server_ip)..."
    
    # Create certificate config
    cat > "$cert_config" << EOF
[req]
default_bits = 2048
prompt = no
distinguished_name = req_distinguished_name
req_extensions = v3_req

[req_distinguished_name]
C = US
ST = CA
L = SF
O = LLM-Router
OU = $server_name
CN = $server_name

[v3_req]
keyUsage = keyEncipherment, dataEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $server_name
DNS.2 = localhost
IP.1 = $server_ip
IP.2 = 127.0.0.1
EOF

    # Generate private key
    openssl genrsa -out "$cert_key" 2048
    chmod 600 "$cert_key"
    
    # Generate certificate signing request
    openssl req -new -key "$cert_key" -out "$cert_csr" -config "$cert_config"
    
    # Sign certificate with CA
    openssl x509 -req -in "$cert_csr" -CA "$CA_CERT" -CAkey "$CA_KEY" \
        -CAcreateserial -out "$cert_file" -days 365 \
        -extensions v3_req -extfile "$cert_config"
    
    chmod 644 "$cert_file"
    
    # Clean up CSR and config
    rm "$cert_csr" "$cert_config"
    
    echo "✅ Certificate generated for $server_name:"
    echo "  Key:  $cert_key"
    echo "  Cert: $cert_file"
}

# Create certificate bundle script
create_bundle_script() {
    cat > "$CERTS_DIR/create-bundle.sh" << 'EOF'
#!/bin/bash
# Create certificate bundles for easy deployment

CERTS_DIR="/etc/llm-router/certs"
BUNDLE_DIR="/etc/llm-router/bundles"

mkdir -p "$BUNDLE_DIR"

echo "Creating certificate bundles..."

# Router bundle
if [[ -f "$CERTS_DIR/router-cert.pem" && -f "$CERTS_DIR/router-key.pem" ]]; then
    tar -czf "$BUNDLE_DIR/router-certs.tar.gz" -C "$CERTS_DIR" \
        router-cert.pem router-key.pem ../ca/ca-cert.pem
    echo "Router bundle: $BUNDLE_DIR/router-certs.tar.gz"
fi

# Inference bundle
if [[ -f "$CERTS_DIR/inference-cert.pem" && -f "$CERTS_DIR/inference-key.pem" ]]; then
    tar -czf "$BUNDLE_DIR/inference-certs.tar.gz" -C "$CERTS_DIR" \
        inference-cert.pem inference-key.pem ../ca/ca-cert.pem
    echo "Inference bundle: $BUNDLE_DIR/inference-certs.tar.gz"
fi

echo "Certificate bundles created."
EOF
    
    chmod +x "$CERTS_DIR/create-bundle.sh"
}

# Set up certificate rotation
setup_cert_rotation() {
    echo "🔄 Setting up certificate rotation..."
    
    # Create renewal script
    cat > "$CERTS_DIR/renew-certs.sh" << EOF
#!/bin/bash
# Certificate renewal script
# Run monthly via cron: 0 2 1 * * /etc/llm-router/certs/renew-certs.sh

CERTS_DIR="$CERTS_DIR"
CA_DIR="$CA_DIR"

# Check certificate expiration (30 days)
check_expiration() {
    local cert_file="\$1"
    local days=30
    
    if openssl x509 -checkend \$((days * 24 * 3600)) -noout -in "\$cert_file" >/dev/null 2>&1; then
        return 1  # Certificate is still valid
    else
        return 0  # Certificate expires within 30 days
    fi
}

# Renew router certificate if needed
if [[ -f "\$CERTS_DIR/router-cert.pem" ]] && check_expiration "\$CERTS_DIR/router-cert.pem"; then
    echo "Renewing router certificate..."
    $(dirname "$0")/setup-mtls-certs.sh generate router 10.0.0.1
    systemctl reload llm-router
fi

# Renew inference certificate if needed
if [[ -f "\$CERTS_DIR/inference-cert.pem" ]] && check_expiration "\$CERTS_DIR/inference-cert.pem"; then
    echo "Renewing inference certificate..."
    $(dirname "$0")/setup-mtls-certs.sh generate inference 10.0.0.2
    systemctl reload llama-inference-prod
fi

echo "Certificate renewal check complete."
EOF
    
    chmod +x "$CERTS_DIR/renew-certs.sh"
    
    # Add to crontab
    (crontab -l 2>/dev/null || true; echo "0 2 1 * * $CERTS_DIR/renew-certs.sh") | crontab -
    
    echo "✅ Certificate rotation configured (monthly check)"
}

# Verify certificates
verify_certificates() {
    echo "🔍 Verifying certificates..."
    
    # Verify CA certificate
    if [[ -f "$CA_CERT" ]]; then
        echo "CA Certificate:"
        openssl x509 -in "$CA_CERT" -text -noout | grep -E "(Subject:|Not Before|Not After)"
        echo ""
    fi
    
    # Verify server certificates
    for cert in "$CERTS_DIR"/*-cert.pem; do
        if [[ -f "$cert" ]]; then
            local cert_name=$(basename "$cert" -cert.pem)
            echo "$cert_name Certificate:"
            openssl x509 -in "$cert" -text -noout | grep -E "(Subject:|Issuer:|Not Before|Not After|DNS:|IP Address:)"
            echo ""
            
            # Verify certificate chain
            if openssl verify -CAfile "$CA_CERT" "$cert" >/dev/null 2>&1; then
                echo "✅ $cert_name certificate chain is valid"
            else
                echo "❌ $cert_name certificate chain is invalid"
            fi
            echo ""
        fi
    done
}

# Main execution
main() {
    local action="${1:-setup}"
    
    case "$action" in
        setup)
            create_directories
            generate_ca
            generate_server_cert "router" "10.0.0.1"
            generate_server_cert "inference" "10.0.0.2"
            create_bundle_script
            setup_cert_rotation
            verify_certificates
            
            echo ""
            echo "✅ mTLS certificate setup complete!"
            echo ""
            echo "Generated certificates:"
            echo "  CA:        $CA_CERT"
            echo "  Router:    $CERTS_DIR/router-cert.pem"
            echo "  Inference: $CERTS_DIR/inference-cert.pem"
            echo ""
            echo "Next steps:"
            echo "1. Copy CA certificate to all servers"
            echo "2. Copy router certificates to router server"
            echo "3. Copy inference certificates to inference server(s)"
            echo "4. Configure services to use mTLS certificates"
            echo ""
            ;;
        
        generate)
            local server_name="$2"
            local server_ip="$3"
            generate_server_cert "$server_name" "$server_ip"
            ;;
        
        verify)
            verify_certificates
            ;;
        
        *)
            echo "Usage: $0 [setup|generate <server_name> <server_ip>|verify]"
            exit 1
            ;;
    esac
}

main "$@"