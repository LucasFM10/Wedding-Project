<script lang="ts">
	import { pb } from '$lib/pocketbase';
	import { env } from '$env/dynamic/public';

	// Método de pagamento selecionado: 'pix' | 'card'
	let metodo = $state<'pix' | 'card'>('pix');

	// Dados gerais do pagamento
	let valor = $state<number>(50.00);
	let description = $state('Cobrança de Teste - Mercado Pago');
	let loading = $state(false);
	let errorMessage = $state('');

	// Campos do formulário de Cartão de Crédito (Valores de teste oficiais do Mercado Pago)
	let cardNumber = $state('5480 8328 0103 3311');
	let cardholderName = $state('APRO VADO');
	let cardExpirationMonth = $state('11');
	let cardExpirationYear = $state('2030');
	let securityCode = $state('123');
	let showSecurityCode = $state(false); // Alternador para ver/ocultar CVV (Olhinho 👁️)
	let identificationNumber = $state('111.111.111-11');
	let installments = $state<number>(1);
	let payerEmail = $state('test_user_card@testuser.com');

	// Detecção de bandeira por BIN
	let detectedBrand = $derived.by(() => {
		const clean = cardNumber.replace(/\D/g, '');
		if (clean.startsWith('5067') || clean.startsWith('650') || clean.startsWith('4011')) return 'elo';
		if (clean.startsWith('4')) return 'visa';
		if (clean.startsWith('5')) return 'master';
		if (clean.startsWith('37') || clean.startsWith('34')) return 'amex';
		if (clean.startsWith('6011') || clean.startsWith('65')) return 'discover';
		if (clean.startsWith('38') || clean.startsWith('30')) return 'diners';
		return 'master';
	});

	// Resposta Pix
	interface PixResponse {
		id?: string;
		status?: string;
		qr_code?: string;
		qr_code_base64?: string;
		ticket_url?: string;
		idempotency_key?: string;
		message?: string;
		error?: string;
		details?: any;
	}
	let pixData = $state<PixResponse | null>(null);
	let pixCopied = $state(false);

	// Resposta Cartão
	interface CardResponse {
		success?: boolean;
		order_id?: string;
		payment_id?: string;
		status?: string;
		status_detail?: string;
		idempotency_key?: string;
		message?: string;
		error?: string;
		details?: any;
	}
	let cardData = $state<CardResponse | null>(null);

	// Instância SDK MercadoPago.js
	let mpInstance: any = null;
	const publicKey = env.PUBLIC_MERCADO_PAGO_PUBLIC_KEY || 'APP_USR_EXEMPLO';

	function setPresetValue(v: number) {
		valor = v;
	}

	// Funções de auto-preenchimento com os cartões de teste OFICIAIS do Mercado Pago
	function fillMastercard() {
		cardNumber = '5480 8328 0103 3311';
		cardholderName = 'APRO VADO';
		cardExpirationMonth = '11';
		cardExpirationYear = '2030';
		securityCode = '123';
	}

	function fillVisa() {
		cardNumber = '4235 6477 2802 5682';
		cardholderName = 'APRO VADO';
		cardExpirationMonth = '11';
		cardExpirationYear = '2030';
		securityCode = '123';
	}

	function fillAmex() {
		cardNumber = '3753 651535 56885';
		cardholderName = 'APRO VADO';
		cardExpirationMonth = '11';
		cardExpirationYear = '2030';
		securityCode = '1234';
	}

	function fillElo() {
		cardNumber = '5067 7667 8388 8311';
		cardholderName = 'APRO VADO';
		cardExpirationMonth = '11';
		cardExpirationYear = '2030';
		securityCode = '123';
	}

	async function loadMercadoPagoSDK(): Promise<any> {
		if (typeof window === 'undefined') return null;
		if ((window as any).MercadoPago) {
			return (window as any).MercadoPago;
		}
		return new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = 'https://sdk.mercadopago.com/js/v2';
			script.onload = () => resolve((window as any).MercadoPago);
			script.onerror = () => reject(new Error('Falha ao carregar o SDK MercadoPago.js'));
			document.body.appendChild(script);
		});
	}

	async function generateCardToken(): Promise<string> {
		const cleanCardNumber = cardNumber.replace(/\s+/g, '');
		const cleanMonth = cardExpirationMonth.padStart(2, '0');
		let cleanYear = cardExpirationYear.trim();
		if (cleanYear.length === 2) {
			cleanYear = '20' + cleanYear;
		}

		if (!publicKey || publicKey === 'APP_USR_EXEMPLO') {
			throw new Error('Public Key de TESTE não foi configurada em PUBLIC_MERCADO_PAGO_PUBLIC_KEY no arquivo .env do frontend.');
		}

		const MP = await loadMercadoPagoSDK();
		if (!MP) {
			throw new Error('Não foi possível carregar a biblioteca SDK MercadoPago.js.');
		}

		if (!mpInstance) {
			mpInstance = new MP(publicKey, { locale: 'pt-BR' });
		}

		try {
			const response = await mpInstance.createCardToken({
				cardNumber: cleanCardNumber,
				cardholderName: cardholderName.trim(),
				cardExpirationMonth: cleanMonth,
				cardExpirationYear: cleanYear,
				securityCode: securityCode.trim(),
				identificationType: 'CPF',
				identificationNumber: identificationNumber.replace(/\D/g, '') || '11111111111'
			});

			if (response && response.id) {
				return response.id;
			}

			// Se o SDK devolver causa de erro tratada
			if (response && response.cause && response.cause.length > 0) {
				const firstCause = response.cause[0];
				const msg = firstCause.description || firstCause.code || 'Dados do cartão inválidos.';
				throw new Error('Erro na tokenização pelo Mercado Pago: ' + msg);
			}

			if (response && response.message) {
				throw new Error('Erro na tokenização pelo Mercado Pago: ' + response.message);
			}

			throw new Error('O Mercado Pago não retornou um ID de token válido para este cartão.');
		} catch (err: any) {
			console.error('Falha na tokenização via MercadoPago.js:', err?.message || err);
			throw new Error(err?.message || 'Falha ao tokenizar os dados do cartão com o Mercado Pago.');
		}
	}

	async function handleCardSubmit(e: Event) {
		e.preventDefault();
		if (!valor || valor <= 0) {
			errorMessage = 'Por favor, insira um valor válido maior que R$ 0,00.';
			return;
		}

		loading = true;
		errorMessage = '';
		cardData = null;

		try {
			// 1. Gera obrigatoriamente o token REAL no frontend via MercadoPago.js
			const realToken = await generateCardToken();

			if (!realToken) {
				throw new Error('Token do cartão não gerado.');
			}

			// 2. Chama o backend APENAS após ter um token real e válido do Mercado Pago
			const result = await pb.send('/api/card-payment', {
				method: 'POST',
				body: {
					token: realToken,
					payment_method_id: detectedBrand,
					installments: Number(installments),
					valor: Number(valor),
					description: description.trim() || 'Pagamento Cartão - Teste',
					payer: {
						email: payerEmail.trim() || 'test_user_card@testuser.com'
					}
				}
			});

			cardData = result as CardResponse;
		} catch (err: any) {
			console.error('Erro no fluxo de cartão:', err?.message || err);
			errorMessage = err?.message || 'Falha ao processar pagamento por cartão.';
		} finally {
			loading = false;
		}
	}

	async function handlePixSubmit(e: Event) {
		e.preventDefault();
		if (!valor || valor <= 0) {
			errorMessage = 'Por favor, insira um valor válido maior que R$ 0,00.';
			return;
		}

		loading = true;
		errorMessage = '';
		pixData = null;
		pixCopied = false;

		try {
			const result = await pb.send('/api/pix', {
				method: 'POST',
				body: {
					valor: Number(valor),
					description: description.trim() || 'Cobrança Pix de Teste'
				}
			});
			pixData = result as PixResponse;
		} catch (err: any) {
			console.error('Erro ao gerar Pix:', err);
			errorMessage = err?.message || 'Falha ao comunicar com o servidor backend PocketBase.';
		} finally {
			loading = false;
		}
	}

	async function copyPixCode() {
		if (pixData?.qr_code) {
			try {
				await navigator.clipboard.writeText(pixData.qr_code);
				pixCopied = true;
				setTimeout(() => {
					pixCopied = false;
				}, 3000);
			} catch (err) {
				console.error('Falha ao copiar:', err);
			}
		}
	}
</script>

<svelte:head>
	<title>Checkout Transparente — Mercado Pago (Ambiente de Testes)</title>
</svelte:head>

<div class="page-container">
	<header class="page-header">
		<a href="/" class="back-link">← Voltar ao Início</a>
		<div class="badge">Ambiente de Testes</div>
		<h1>💳 Checkout Transparente (Orders API)</h1>
		<p class="subtitle">
			Gere pagamentos de teste via Pix ou Cartão de Crédito integrando MercadoPago.js e PocketBase.
		</p>
	</header>

	<!-- Layout vertical empilhado (uma sessão abaixo da outra, mais espaçoso) -->
	<div class="sections-stack">
		<!-- SESSÃO 1: FORMULÁRIO DE PAGAMENTO -->
		<section class="card-section">
			<h2>1. Dados e Método de Pagamento</h2>

			<!-- Seletor de Método de Pagamento (Tabs) -->
			<div class="payment-selector">
				<button
					type="button"
					class="selector-tab"
					class:active={metodo === 'pix'}
					onclick={() => (metodo = 'pix')}
				>
					<span class="tab-icon">📱</span>
					<span class="tab-text">Pix</span>
				</button>
				<button
					type="button"
					class="selector-tab"
					class:active={metodo === 'card'}
					onclick={() => (metodo = 'card')}
				>
					<span class="tab-icon">💳</span>
					<span class="tab-text">Cartão de Crédito</span>
				</button>
			</div>

			<!-- Valor e Descrição -->
			<div class="form-row">
				<div class="form-group col-half">
					<label for="valor">Valor da Cobrança (R$)</label>
					<div class="input-prefix">
						<span class="currency">R$</span>
						<input
							type="number"
							id="valor"
							step="0.01"
							min="0.01"
							bind:value={valor}
							placeholder="0.00"
							required
						/>
					</div>
				</div>

				<div class="form-group col-half">
					<label for="description">Descrição</label>
					<input
						type="text"
						id="description"
						bind:value={description}
						placeholder="Ex: Presente de Casamento"
					/>
				</div>
			</div>

			<div class="presets">
				<span class="preset-label">Valores sugeridos:</span>
				<div class="preset-buttons">
					<button type="button" class="btn-chip" onclick={() => setPresetValue(15)}>R$ 15,00</button>
					<button type="button" class="btn-chip" onclick={() => setPresetValue(50)}>R$ 50,00</button>
					<button type="button" class="btn-chip" onclick={() => setPresetValue(100)}>R$ 100,00</button>
				</div>
			</div>

			{#if errorMessage}
				<div class="alert alert-error">
					⚠️ {errorMessage}
				</div>
			{/if}

			<!-- Formulário Pix -->
			{#if metodo === 'pix'}
				<form onsubmit={handlePixSubmit}>
					<button type="submit" class="btn-primary" disabled={loading}>
						{#if loading}
							<span class="spinner"></span> Gerando Pix...
						{:else}
							⚡ Gerar QrCode Pix
						{/if}
					</button>
				</form>
			{/if}

			<!-- Formulário de Cartão de Crédito -->
			{#if metodo === 'card'}
				<form onsubmit={handleCardSubmit} class="card-form">
					<!-- Barra de Auto-preenchimento Rápido -->
					<div class="test-fill-bar">
						<span class="fill-title">🧪 Auto-preencher com Cartões de Teste do seu Painel:</span>
						<div class="fill-buttons">
							<button type="button" class="btn-fill green" onclick={fillMastercard}>
								💳 Mastercard (5480...)
							</button>
							<button type="button" class="btn-fill blue" onclick={fillVisa}>
								💳 Visa (4235...)
							</button>
							<button type="button" class="btn-fill amex" onclick={fillAmex}>
								💳 Amex (3753...)
							</button>
							<button type="button" class="btn-fill elo" onclick={fillElo}>
								💳 Elo (5067...)
							</button>
						</div>
					</div>

					<div class="form-group">
						<label for="cardNumber">Número do Cartão</label>
						<div class="input-with-brand">
							<input
								type="text"
								id="cardNumber"
								bind:value={cardNumber}
								placeholder="0000 0000 0000 0000"
								maxlength="19"
								required
							/>
							<span class="brand-badge">{detectedBrand.toUpperCase()}</span>
						</div>
					</div>

					<div class="form-group">
						<label for="cardholderName">Nome impresso no Cartão</label>
						<input
							type="text"
							id="cardholderName"
							bind:value={cardholderName}
							placeholder="Ex: APRO VADO"
							required
						/>
					</div>

					<div class="form-row">
						<div class="form-group col-half">
							<label for="cardExpMonth">Validade (MM/AAAA)</label>
							<div class="exp-inputs">
								<input
									type="text"
									id="cardExpMonth"
									bind:value={cardExpirationMonth}
									placeholder="MM"
									maxlength="2"
									required
								/>
								<span class="slash">/</span>
								<input
									type="text"
									id="cardExpYear"
									bind:value={cardExpirationYear}
									placeholder="AAAA"
									maxlength="4"
									required
								/>
							</div>
						</div>

						<!-- Campo CVV com o Botão de Olhinho (👁️ / 🙈) -->
						<div class="form-group col-half">
							<label for="securityCode">CVV (Código de Segurança)</label>
							<div class="input-eye-wrapper">
								<input
									type={showSecurityCode ? 'text' : 'password'}
									id="securityCode"
									bind:value={securityCode}
									placeholder="123"
									maxlength="4"
									required
								/>
								<button
									type="button"
									class="btn-eye"
									onclick={() => (showSecurityCode = !showSecurityCode)}
									title={showSecurityCode ? 'Ocultar CVV' : 'Mostrar CVV'}
								>
									{showSecurityCode ? '🙈' : '👁️'}
								</button>
							</div>
						</div>
					</div>

					<div class="form-row">
						<div class="form-group col-half">
							<label for="payerEmail">E-mail do Pagador</label>
							<input
								type="email"
								id="payerEmail"
								bind:value={payerEmail}
								placeholder="teste@testuser.com"
								required
							/>
						</div>

						<div class="form-group col-half">
							<label for="installments">Parcelas</label>
							<select id="installments" bind:value={installments}>
								<option value={1}>1x de R$ {valor.toFixed(2)} (à vista)</option>
								<option value={2}>2x de R$ {(valor / 2).toFixed(2)}</option>
								<option value={3}>3x de R$ {(valor / 3).toFixed(2)}</option>
								<option value={6}>6x de R$ {(valor / 6).toFixed(2)}</option>
								<option value={12}>12x de R$ {(valor / 12).toFixed(2)}</option>
							</select>
						</div>
					</div>

					<button type="submit" class="btn-primary" disabled={loading}>
						{#if loading}
							<span class="spinner"></span> Processando Pagamento...
						{:else}
							🔒 Realizar Pagamento com Cartão
						{/if}
					</button>
				</form>
			{/if}
		</section>

		<!-- SESSÃO 2: RESULTADO DO PAGAMENTO (Empilhada abaixo) -->
		<section class="card-section result-card">
			<h2>2. Resultado da Transação</h2>

			{#if loading}
				<div class="placeholder-state">
					<div class="loader-pulse"></div>
					<p>Comunicando com a Orders API do Mercado Pago...</p>
				</div>

			<!-- RESULTADO PIX -->
			{:else if metodo === 'pix' && pixData}
				{#if pixData.status === 'placeholder_credentials'}
					<div class="alert alert-warning">
						<h3>🔑 Modo Demonstrativo (Placeholder)</h3>
						<p>{pixData.message}</p>
					</div>
				{:else if pixData.error}
					<div class="alert alert-error">
						<h3>❌ Erro ao Gerar Pix</h3>
						<p>{pixData.error}</p>
					</div>
				{:else}
					<div class="result-box">
						<div class="status-badge success">
							<span class="dot"></span> Status: {pixData.status || 'Criado'}
						</div>

						{#if pixData.qr_code_base64}
							<div class="qrcode-container">
								<img
									src="data:image/png;base64,{pixData.qr_code_base64}"
									alt="QR Code Pix"
									class="qrcode-img"
								/>
							</div>
						{/if}

						{#if pixData.qr_code}
							<div class="form-group">
								<label for="copiaecola">Pix Copia e Cola:</label>
								<div class="copy-box">
									<input
										type="text"
										id="copiaecola"
										readonly
										value={pixData.qr_code}
										onclick={(e) => e.currentTarget.select()}
									/>
									<button type="button" class="btn-copy" onclick={copyPixCode}>
										{pixCopied ? '✅ Copiado!' : '📋 Copiar'}
									</button>
								</div>
							</div>
						{/if}

						<div class="meta-info">
							{#if pixData.id}
								<div class="meta-item">
									<span class="label">ID da Ordem:</span>
									<span class="val">{pixData.id}</span>
								</div>
							{/if}
							{#if pixData.idempotency_key}
								<div class="meta-item">
									<span class="label">Idempotency Key:</span>
									<span class="val font-mono">{pixData.idempotency_key}</span>
								</div>
							{/if}
							{#if pixData.ticket_url}
								<div class="meta-item">
									<a href={pixData.ticket_url} target="_blank" rel="noopener noreferrer" class="link-ticket">
										🔗 Abrir Comprovante / Ticket ↗
									</a>
								</div>
							{/if}
						</div>
					</div>
				{/if}

			<!-- RESULTADO CARTÃO DE CRÉDITO -->
			{:else if metodo === 'card' && cardData}
				{#if cardData.status === 'placeholder_credentials'}
					<div class="alert alert-warning">
						<h3>🔑 Modo Demonstrativo (Placeholder)</h3>
						<p>{cardData.message}</p>
					</div>
				{:else if cardData.success === false}
					<div class="alert alert-error">
						<h3>❌ Transação Recusada ou Erro</h3>
						<p>{cardData.error}</p>
						{#if cardData.details}
							<pre><code>{JSON.stringify(cardData.details, null, 2)}</code></pre>
						{/if}
					</div>
				{:else}
					<div class="result-box">
						{#if cardData.status === 'approved'}
							<div class="status-badge success">
								<span class="dot"></span> Aprovado (approved)
							</div>
						{:else if cardData.status === 'in_process' || cardData.status === 'action_required'}
							<div class="status-badge warning">
								<span class="dot yellow"></span> Em Processamento ({cardData.status})
							</div>
						{:else}
							<div class="status-badge danger">
								<span class="dot red"></span> Recusado ({cardData.status || 'rejected'})
							</div>
						{/if}

						<div class="meta-info">
							{#if cardData.order_id}
								<div class="meta-item">
									<span class="label">ID da Order (Orders API):</span>
									<span class="val font-mono">{cardData.order_id}</span>
								</div>
							{/if}
							{#if cardData.payment_id}
								<div class="meta-item">
									<span class="label">ID do Pagamento:</span>
									<span class="val font-mono">{cardData.payment_id}</span>
								</div>
							{/if}
							{#if cardData.status_detail}
								<div class="meta-item">
									<span class="label">Detalhe do Status:</span>
									<span class="val">{cardData.status_detail}</span>
								</div>
							{/if}
							{#if cardData.idempotency_key}
								<div class="meta-item">
									<span class="label">X-Idempotency-Key:</span>
									<span class="val font-mono">{cardData.idempotency_key}</span>
								</div>
							{/if}
						</div>
					</div>
				{/if}

			{:else}
				<div class="placeholder-state">
					<div class="pix-icon">
						{metodo === 'pix' ? '📱' : '💳'}
					</div>
					<p>
						{#if metodo === 'pix'}
							Preencha os dados e clique em <strong>Gerar QrCode Pix</strong>.
						{:else}
							Preencha o cartão e clique em <strong>Realizar Pagamento com Cartão</strong>.
						{/if}
					</p>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.page-container {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		max-width: 780px;
		margin: 0 auto;
		padding-bottom: 3rem;
	}

	.page-header {
		position: relative;
		background: #ffffff;
		padding: 1.75rem 2rem;
		border-radius: 12px;
		border: 1px solid #e2e8f0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.back-link {
		display: inline-block;
		color: #2563eb;
		text-decoration: none;
		font-weight: 600;
		margin-bottom: 0.75rem;
		font-size: 0.9rem;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	.badge {
		position: absolute;
		top: 1.75rem;
		right: 2rem;
		background: #e0f2fe;
		color: #0369a1;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.3rem 0.8rem;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	h1 {
		margin: 0 0 0.5rem 0;
		font-size: 1.75rem;
		color: #0f172a;
	}

	.subtitle {
		margin: 0;
		color: #64748b;
		font-size: 0.95rem;
	}

	/* Layout empilhado verticalmente (sessões uma abaixo da outra) */
	.sections-stack {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.card-section {
		background: #ffffff;
		padding: 2rem;
		border-radius: 12px;
		border: 1px solid #e2e8f0;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
	}

	.card-section h2 {
		margin-top: 0;
		margin-bottom: 1.5rem;
		font-size: 1.25rem;
		color: #1e293b;
		border-bottom: 1px solid #f1f5f9;
		padding-bottom: 0.85rem;
	}

	.payment-selector {
		display: flex;
		gap: 1rem;
		margin-bottom: 1.75rem;
	}

	.selector-tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 0.85rem 1.25rem;
		background: #f8fafc;
		border: 2px solid #e2e8f0;
		border-radius: 10px;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		color: #475569;
		transition: all 0.2s;
	}

	.selector-tab.active {
		border-color: #2563eb;
		background: #eff6ff;
		color: #1d4ed8;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	label {
		display: block;
		font-size: 0.9rem;
		font-weight: 600;
		color: #334155;
		margin-bottom: 0.5rem;
	}

	.input-prefix {
		display: flex;
		align-items: center;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		background: #ffffff;
		overflow: hidden;
	}

	.input-prefix:focus-within {
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}

	.currency {
		padding: 0.75rem 1rem;
		background: #f8fafc;
		color: #64748b;
		font-weight: 600;
		border-right: 1px solid #cbd5e1;
	}

	.input-prefix input {
		border: none;
		outline: none;
		width: 100%;
		padding: 0.75rem 1rem;
		font-size: 1.15rem;
		font-weight: 600;
		color: #0f172a;
	}

	input[type='text'],
	input[type='email'],
	input[type='password'],
	select {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem 1rem;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		font-size: 0.95rem;
		outline: none;
		background: #ffffff;
		color: #0f172a;
	}

	input[type='text']:focus,
	input[type='email']:focus,
	input[type='password']:focus,
	select:focus {
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}

	/* Wrapper do CVV com o Botão de Olhinho (👁️) */
	.input-eye-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.input-eye-wrapper input {
		padding-right: 2.75rem;
	}

	.btn-eye {
		position: absolute;
		right: 0.5rem;
		background: transparent;
		border: none;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 0.35rem 0.5rem;
		border-radius: 4px;
		transition: background-color 0.2s;
	}

	.btn-eye:hover {
		background: #f1f5f9;
	}

	.input-with-brand {
		position: relative;
	}

	.brand-badge {
		position: absolute;
		right: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
		background: #e2e8f0;
		color: #1e293b;
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.25rem 0.6rem;
		border-radius: 4px;
	}

	.form-row {
		display: flex;
		gap: 1.25rem;
	}

	@media (max-width: 600px) {
		.form-row {
			flex-direction: column;
			gap: 0;
		}
	}

	.col-half {
		flex: 1;
	}

	.exp-inputs {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.slash {
		color: #94a3b8;
		font-weight: bold;
		font-size: 1.2rem;
	}

	.test-fill-bar {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		padding: 1rem;
		border-radius: 10px;
		margin-bottom: 1.5rem;
	}

	.fill-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #475569;
		display: block;
		margin-bottom: 0.6rem;
	}

	.fill-buttons {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.btn-fill {
		border: 1px solid #cbd5e1;
		background: #ffffff;
		padding: 0.4rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-fill.green:hover {
		background: #f0fdf4;
		border-color: #86efac;
	}

	.btn-fill.blue:hover {
		background: #eff6ff;
		border-color: #93c5fd;
	}

	.btn-fill.amex:hover {
		background: #fefce8;
		border-color: #fde047;
	}

	.btn-fill.elo:hover {
		background: #faf5ff;
		border-color: #d8b4fe;
	}

	.presets {
		margin-bottom: 1.5rem;
	}

	.preset-label {
		font-size: 0.85rem;
		color: #64748b;
		display: block;
		margin-bottom: 0.5rem;
	}

	.preset-buttons {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	.btn-chip {
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		color: #334155;
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-chip:hover {
		background: #e2e8f0;
		color: #0f172a;
	}

	.btn-primary {
		width: 100%;
		background: #2563eb;
		color: #ffffff;
		border: none;
		padding: 0.95rem 1.5rem;
		border-radius: 10px;
		font-size: 1.05rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		margin-top: 1rem;
	}

	.btn-primary:hover:not(:disabled) {
		background: #1d4ed8;
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.placeholder-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3.5rem 1rem;
		text-align: center;
		color: #64748b;
	}

	.loader-pulse {
		width: 36px;
		height: 36px;
		border: 3px solid #2563eb;
		border-bottom-color: transparent;
		border-radius: 50%;
		animation: rotation 1s linear infinite;
		margin-bottom: 1rem;
	}

	.pix-icon {
		font-size: 3.5rem;
		margin-bottom: 1rem;
	}

	.alert {
		padding: 1.25rem;
		border-radius: 10px;
		margin-bottom: 1.25rem;
		font-size: 0.95rem;
	}

	.alert-error {
		background: #fef2f2;
		color: #991b1b;
		border: 1px solid #fecaca;
	}

	.alert-warning {
		background: #fffbebfb;
		color: #92400e;
		border: 1px solid #fde68a;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.9rem;
		border-radius: 999px;
		font-size: 0.9rem;
		font-weight: 600;
		margin-bottom: 1.5rem;
	}

	.status-badge.success {
		background: #dcfce7;
		color: #166534;
	}

	.status-badge.warning {
		background: #fef3c7;
		color: #92400e;
	}

	.status-badge.danger {
		background: #fee2e2;
		color: #991b1b;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #22c55e;
	}

	.dot.yellow {
		background: #f59e0b;
	}

	.dot.red {
		background: #ef4444;
	}

	.qrcode-container {
		display: flex;
		justify-content: center;
		margin-bottom: 1.5rem;
		padding: 1.5rem;
		background: #f8fafc;
		border-radius: 12px;
		border: 1px dashed #cbd5e1;
	}

	.qrcode-img {
		max-width: 240px;
		height: auto;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}

	.copy-box {
		display: flex;
		gap: 0.5rem;
	}

	.copy-box input {
		font-family: monospace;
		font-size: 0.9rem;
	}

	.btn-copy {
		background: #0f172a;
		color: #ffffff;
		border: none;
		padding: 0.7rem 1.25rem;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.2s;
	}

	.btn-copy:hover {
		background: #334155;
	}

	.meta-info {
		margin-top: 1.5rem;
		padding-top: 1.25rem;
		border-top: 1px solid #f1f5f9;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		font-size: 0.9rem;
		color: #475569;
	}

	.meta-item {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.val {
		font-weight: 600;
		color: #0f172a;
	}

	.font-mono {
		font-family: monospace;
		font-size: 0.85rem;
	}

	.link-ticket {
		color: #2563eb;
		text-decoration: none;
		font-weight: 600;
	}

	.link-ticket:hover {
		text-decoration: underline;
	}

	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid #ffffff;
		border-bottom-color: transparent;
		border-radius: 50%;
		display: inline-block;
		animation: rotation 1s linear infinite;
	}

	@keyframes rotation {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
</style>
