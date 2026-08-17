// ============================================================
// PocketBase JS Hook — Rota Backend /api/pix (Mercado Pago Orders API)
// ============================================================

routerAdd("POST", "/api/pix", (c) => {
    try {
        // 1. Obter MERCADO_PAGO_ACCESS_TOKEN exclusivamente no backend
        let token = $os.getenv("MERCADO_PAGO_ACCESS_TOKEN") || (typeof process !== "undefined" && process.env ? process.env.MERCADO_PAGO_ACCESS_TOKEN : "");
        
        // Fallback: tentar ler do arquivo .env local se o processo não tiver exportado a variável
        if (!token || token === "") {
            try {
                const envContent = $os.readFile("apps/pocketbase/.env") || $os.readFile(".env");
                if (envContent) {
                    const lines = envContent.split("\n");
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (line.startsWith("MERCADO_PAGO_ACCESS_TOKEN=")) {
                            token = line.split("=")[1].trim();
                            break;
                        }
                    }
                }
            } catch (e) {
                // ignorar erro de leitura
            }
        }

        if (!token) {
            token = "APP_USR_EXEMPLO";
        }

        // 2. Extrair dados da requisição
        let reqData = {};
        try {
            if (c.requestInfo) {
                const info = c.requestInfo();
                reqData = info ? (info.body || info.data || {}) : {};
            } else if (typeof $apis !== "undefined" && $apis.requestInfo) {
                const info = $apis.requestInfo(c);
                reqData = info ? (info.body || info.data || {}) : {};
            }
        } catch (e) {
            reqData = {};
        }

        const valor = parseFloat(reqData.valor || reqData.amount || reqData.transaction_amount || 10.00);
        const valorStr = valor.toFixed(2);

        // 3. Gerar um X-Idempotency-Key único (UUID v4) por requisição
        function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(ch) {
                const r = Math.random() * 16 | 0, v = ch === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        const idempotencyKey = (typeof $security !== 'undefined' && $security.uuidv4) ? $security.uuidv4() : generateUUID();

        // 4. Se o token for o placeholder de exemplo
        if (token === "APP_USR_EXEMPLO") {
            return c.json(200, {
                success: true,
                status: "placeholder_credentials",
                message: "MERCADO_PAGO_ACCESS_TOKEN está definido como placeholder (APP_USR_EXEMPLO). Substitua pelo seu Access Token real em apps/pocketbase/.env.",
                idempotency_key: idempotencyKey
            });
        }

        // 5. Chamada à Mercado Pago Orders API (POST /v1/orders) para Checkout Transparente Pix
        const mpUrl = "https://api.mercadopago.com/v1/orders";
        const orderPayload = {
            type: "online",
            total_amount: valorStr,
            description: reqData.description || "Cobrança Pix de Teste",
            external_reference: reqData.external_reference || ("order_" + Date.now()),
            payer: {
                email: reqData.email || "test_user_pix@testuser.com"
            },
            transactions: {
                payments: [
                    {
                        amount: valorStr,
                        payment_method: {
                            id: "pix",
                            type: "bank_transfer"
                        }
                    }
                ]
            }
        };

        const mpResponse = $http.send({
            url: mpUrl,
            method: "POST",
            headers: {
                "Authorization": "Bearer " + token,
                "X-Idempotency-Key": idempotencyKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(orderPayload)
        });

        const resData = mpResponse.json || {};

        if (mpResponse.statusCode >= 400) {
            return c.json(200, {
                success: false,
                error: resData.message || resData.error || ("Erro na API de Orders do Mercado Pago (Status HTTP " + mpResponse.statusCode + ")"),
                status_code: mpResponse.statusCode,
                details: resData,
                idempotency_key: idempotencyKey
            });
        }

        // 6. Mapear os dados de resposta da Orders API
        let qrCode = null;
        let qrCodeBase64 = null;
        let ticketUrl = null;

        if (resData.transactions && resData.transactions.payments && resData.transactions.payments.length > 0) {
            const firstPayment = resData.transactions.payments[0];
            if (firstPayment.payment_method) {
                qrCode = firstPayment.payment_method.qr_code || null;
                qrCodeBase64 = firstPayment.payment_method.qr_code_base64 || null;
                ticketUrl = firstPayment.payment_method.ticket_url || null;
            }
        }

        if (!qrCode && resData.point_of_interaction && resData.point_of_interaction.transaction_data) {
            qrCode = resData.point_of_interaction.transaction_data.qr_code || null;
            qrCodeBase64 = resData.point_of_interaction.transaction_data.qr_code_base64 || null;
            ticketUrl = resData.point_of_interaction.transaction_data.ticket_url || null;
        }

        return c.json(200, {
            success: true,
            id: resData.id || null,
            status: resData.status || "action_required",
            status_detail: resData.status_detail || null,
            qr_code: qrCode,
            qr_code_base64: qrCodeBase64,
            ticket_url: ticketUrl,
            idempotency_key: idempotencyKey
        });

    } catch (err) {
        return c.json(200, {
            success: false,
            error: "Erro interno no servidor PocketBase ao processar Pix via Orders API",
            details: String(err)
        });
    }
});
