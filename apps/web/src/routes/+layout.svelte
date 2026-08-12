<script lang="ts">
	let { children } = $props();
</script>

<main>
	{@render children()}
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		margin: 0;
		padding: 0;
		background-color: #FFF8F3;
		color: #2F1822;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		min-height: 100vh;
	}

	:global(h1, h2, h3, .font-serif) {
		font-family: 'Playfair Display', Georgia, serif;
	}

	main {
		max-width: 1140px;
		margin: 2.5rem auto;
		padding: 0 1.5rem 4rem 1.5rem;
	}

	@media (max-width: 600px) {
		main {
			margin: 1rem auto;
			padding: 0 0.75rem 3rem 0.75rem;
		}
	}
</style>
