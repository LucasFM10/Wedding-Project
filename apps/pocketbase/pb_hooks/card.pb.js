// ============================================================
// PocketBase JS Hook — Rota Backend /api/card-payment (Mercado Pago Orders API)
// ============================================================

routerAdd("POST", "/api/card-payment", (c) => {
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

        // 2. Extrair dados da requisição enviados pelo frontend (tokenizado via MercadoPago.js)
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

        const valor = parseFloat(reqData.valor || reqData.amount || reqData.transaction_amount || 50.00);
        const valorStr = valor.toFixed(2);
        const cardToken = reqData.token || reqData.card_token;

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
                message: "MERCADO_PAGO_ACCESS_TOKEN está definido como placeholder (APP_USR_EXEMPLO). Substitua pelo seu Access Token real de TESTE em apps/pocketbase/.env.",
                idempotency_key: idempotencyKey
            });
        }

        if (!cardToken) {
            return c.json(200, {
                success: false,
                error: "Token do cartão não fornecido pelo frontend. Verifique a tokenização segura no navegador.",
                idempotency_key: idempotencyKey
            });
        }

        // 5. Chamada à Mercado Pago Orders API (POST /v1/orders) para pagamento com Cartão de Crédito
        const mpUrl = "https://api.mercadopago.com/v1/orders";
        
        const paymentMethodObj = {
            id: reqData.payment_method_id || "master",
            type: "credit_card",
            token: cardToken,
            installments: parseInt(reqData.installments || 1, 10)
        };

        if (reqData.issuer_id) {
            paymentMethodObj.issuer_id = String(reqData.issuer_id);
        }

        const orderPayload = {
            type: "online",
            total_amount: valorStr,
            description: reqData.description || "Pagamento Cartão de Crédito - Teste",
            external_reference: reqData.external_reference || ("order_card_" + Date.now()),
            payer: {
                email: (reqData.payer && reqData.payer.email) ? reqData.payer.email : "test_user_card@testuser.com"
            },
            transactions: {
                payments: [
                    {
                        amount: valorStr,
                        payment_method: paymentMethodObj
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
                error: resData.message || resData.error || ("Erro na Orders API do Mercado Pago (Status HTTP " + mpResponse.statusCode + ")"),
                status_code: mpResponse.statusCode,
                details: resData,
                idempotency_key: idempotencyKey
            });
        }

        // 6. Mapear o resultado da transação
        let status = resData.status || "approved";
        let statusDetail = resData.status_detail || "accredited";
        let paymentId = null;

        if (resData.transactions && resData.transactions.payments && resData.transactions.payments.length > 0) {
            const firstPayment = resData.transactions.payments[0];
            paymentId = firstPayment.id || null;
            if (firstPayment.status) status = firstPayment.status;
            if (firstPayment.status_detail) statusDetail = firstPayment.status_detail;
        }

        return c.json(200, {
            success: true,
            order_id: resData.id || null,
            payment_id: paymentId,
            status: status,
            status_detail: statusDetail,
            idempotency_key: idempotencyKey
        });

    } catch (err) {
        return c.json(200, {
            success: false,
            error: "Erro interno no servidor PocketBase ao processar pagamento por cartão",
            details: String(err)
        });
    }
});
