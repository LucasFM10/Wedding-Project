<script lang="ts">
  import { onMount } from 'svelte';
  import { pb } from '$lib/pocketbase';
  import { auth } from '$lib/auth.svelte';
  import { casamentoState, type CasamentoRecord } from '$lib/casamento.svelte';

  interface Convidado {
    id: string;
    nome: string;
    contato: string;
    email: string;
    confirmacao: 'Confirmado' | 'Pendente' | 'Convite entregue' | 'Não vai';
    tags: string[];
    isAcompanhante: boolean;
    convidadoPrincipalId?: string; // ID do Convidado Principal
    customFields: Record<string, string>;
  }

  interface ColunaConfig {
    id: string;
    label: string;
    visivel: boolean;
    custom?: boolean;
  }

  // Estado de Login / Auth Form
  let loginEmail = $state('user@teste.com');
  let loginPassword = $state('senha123456');
  let authError = $state('');
  let authLoading = $state(false);

  // Estado do Formulário de Criar Novo Set "Casamento"
  let isCriandoNovoSet = $state(false);
  let novoSetTitulo = $state('');
  let novoSetData = $state('');
  let setCreatingLoading = $state(false);
  let setCreatingError = $state('');

  // Estado da Importação Interativa de CSV
  type ColumnRole = 'nome' | 'contato' | 'email' | 'confirmacao' | 'tag' | 'ignorar';

  interface CsvHeaderCol {
    name: string;
    sample: string;
    role: ColumnRole;
  }

  let isCsvModalOpen = $state(false);
  let csvRawLines = $state<string[][]>([]);
  let csvHeaders = $state<CsvHeaderCol[]>([]);
  let csvImporting = $state(false);
  let csvStep = $state<'file' | 'map' | 'preview'>('file');

  // Configuração inicial das colunas da tabela
  let colunas = $state<ColunaConfig[]>([
    { id: 'contato', label: 'Contato', visivel: true },
    { id: 'confirmacao', label: 'Confirmação', visivel: true },
    { id: 'tags', label: 'Tags', visivel: true },
    { id: 'acompanhante', label: 'É acompanhante?', visivel: true },
    { id: 'acoes', label: 'Ações', visivel: true }
  ]);

  // Lista global de tags disponíveis para uso
  let tagsDisponiveis = $state<string[]>([]);

  // Lista de Convidados Reativa
  let convidados = $state<Convidado[]>([]);

  // Estado de Drag & Drop
  let draggedIndex = $state<number | null>(null);

  // Estado de Agrupamento por Tags
  let isAgrupadoPorTag = $state(false);

  // Estado de busca e filtros
  let busca = $state('');
  let filtroStatus = $state<string>('Todos');
  let tagsFiltroAtivas = $state<string[]>([]);

  // Popover de Colunas
  let showColunasMenu = $state(false);
  let novaColunaNome = $state('');

  // Modal de Gerenciador de Tags
  let isTagManagerOpen = $state(false);
  let novaTagNome = $state('');
  let tagEmEdicao = $state<string | null>(null);
  let tagNovoNomeEdicao = $state('');

  // Modal de Convidado (Adicionar / Editar)
  let isModalOpen = $state(false);
  let editingGuestId = $state<string | null>(null);

  // Campos do formulário de convidado
  let formNome = $state('');
  let formContato = $state('');
  let formEmail = $state('');
  let formConfirmacao = $state<'Confirmado' | 'Pendente' | 'Convite entregue' | 'Não vai'>('Pendente');
  let formTags = $state<string[]>([]);
  let formIsAcompanhante = $state(false);
  let formConvidadoPrincipalId = $state<string>('');
  let formCustomFields = $state<Record<string, string>>({});

  /* ----------------------------------------------------
     AUTENTICAÇÃO & MULTI-TENANCY (SETS "CASAMENTO")
  ---------------------------------------------------- */
  async function handleLogin(e: Event) {
    e.preventDefault();
    authError = '';
    authLoading = true;
    try {
      await auth.login(loginEmail, loginPassword);
      if (auth.user) {
        await casamentoState.carregarCasamentosDoUsuario(auth.user.id);
        if (casamentoState.casamentoAtivo) {
          await carregarConvidadosDoCasamento(casamentoState.casamentoAtivo.id);
        }
      }
    } catch (err: any) {
      console.error(err);
      authError = 'Falha ao autenticar. Verifique e-mail e senha (ex: user@teste.com / senha123456).';
    } finally {
      authLoading = false;
    }
  }

  function handleLogout() {
    auth.logout();
    casamentoState.limpar();
    convidados = [];
    isCriandoNovoSet = false;
  }

  async function carregarConvidadosDoCasamento(casamentoId: string) {
    try {
      const records = await pb.collection('convidados').getFullList({
        filter: `casamento = "${casamentoId}"`
      });

      convidados = records.map(r => ({
        id: r.id,
        nome: r.nome,
        contato: r.contato || '',
        email: r.email || '',
        confirmacao: (r.confirmacao as any) || 'Pendente',
        tags: r.tags || [],
        isAcompanhante: r.is_acompanhante || false,
        convidadoPrincipalId: r.convidado_principal || undefined,
        customFields: r.custom_fields || {}
      }));

      // Extrai dinamicamente todas as tags ativas dos convidados do banco
      const tagsDoBanco = Array.from(new Set(convidados.flatMap(c => c.tags))).filter(Boolean);
      if (tagsDoBanco.length > 0) {
        tagsDisponiveis = tagsDoBanco;
      }
    } catch (e) {
      console.warn('Erro ao carregar convidados do PocketBase:', e);
      convidados = [];
    }
  }

  async function handleSelecionarCasamento(c: CasamentoRecord) {
    casamentoState.selecionarCasamento(c);
    isCriandoNovoSet = false;
    await carregarConvidadosDoCasamento(c.id);
  }

  async function handleCriarNovoCasamento(e: Event) {
    e.preventDefault();
    if (!novoSetTitulo.trim() || !auth.user) return;

    setCreatingError = '';
    setCreatingLoading = true;

    try {
      const novoCasamento = await casamentoState.criarNovoCasamento(
        auth.user.id,
        novoSetTitulo.trim(),
        novoSetData
      );

      novoSetTitulo = '';
      novoSetData = '';
      isCriandoNovoSet = false;
      await carregarConvidadosDoCasamento(novoCasamento.id);
    } catch (err: any) {
      setCreatingError = err.message || 'Erro ao criar o casamento.';
    } finally {
      setCreatingLoading = false;
    }
  }

  function preencherTeste() {
    loginEmail = 'user@teste.com';
    loginPassword = 'senha123456';
  }

  /* ----------------------------------------------------
     DRAG AND DROP REORDERING
  ---------------------------------------------------- */
  function handleDragStart(e: DragEvent, index: number) {
    draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }

  function handleDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      draggedIndex = null;
      return;
    }

    const reordered = [...convidados];
    const [movedItem] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);

    convidados = reordered;
    draggedIndex = null;
  }

  /* ----------------------------------------------------
     ORDENAÇÃO ALFABÉTICA (A-Z)
  ---------------------------------------------------- */
  function ordenarAlfaAZ() {
    convidados = [...convidados].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /* ----------------------------------------------------
     PARSER E MAPEADOR INTERATIVO DE CSV
  ---------------------------------------------------- */
  function parseCSV(text: string): string[][] {
    const lines: string[][] = [];
    let row: string[] = [];
    let entry = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (c === '"') {
        if (inQuotes && next === '"') {
          entry += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        row.push(entry.trim());
        entry = '';
      } else if ((c === '\r' || c === '\n') && !inQuotes) {
        if (c === '\r' && next === '\n') i++;
        row.push(entry.trim());
        if (row.some(cell => cell.length > 0)) {
          lines.push(row);
        }
        row = [];
        entry = '';
      } else {
        entry += c;
      }
    }
    if (entry || row.length > 0) {
      row.push(entry.trim());
      if (row.some(cell => cell.length > 0)) {
        lines.push(row);
      }
    }
    return lines;
  }

  function handleFileSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (!content) return;

      const parsed = parseCSV(content);
      if (parsed.length < 2) {
        alert('O arquivo CSV parece estar vazio ou não possui linhas de dados.');
        return;
      }

      csvRawLines = parsed;
      const headers = parsed[0];
      const firstRow = parsed[1] || [];

      csvHeaders = headers.map((h, i) => {
        const hLower = h.toLowerCase();
        let role: ColumnRole = 'ignorar';

        if (hLower.includes('nome') || hLower === 'name' || hLower === 'convidado') {
          role = 'nome';
        } else if (hLower.includes('contato') || hLower.includes('telefone') || hLower.includes('phone')) {
          role = 'contato';
        } else if (hLower.includes('email')) {
          role = 'email';
        } else if (hLower.includes('presença') || hLower.includes('presenca') || hLower.includes('status') || hLower.includes('confirmação')) {
          role = 'confirmacao';
        } else if (
          hLower.includes('convidado por') ||
          hLower.includes('relação') ||
          hLower.includes('relacao') ||
          hLower.includes('missão') ||
          hLower.includes('missao') ||
          hLower.includes('idade') ||
          hLower.includes('restrição') ||
          hLower.includes('restricao') ||
          hLower.includes('tag')
        ) {
          role = 'tag';
        }

        return {
          name: h,
          sample: firstRow[i] || '',
          role
        };
      });

      csvStep = 'map';
    };
    reader.readAsText(file, 'UTF-8');
  }

  let csvPreviewConvidados = $derived.by(() => {
    if (csvRawLines.length < 2) return [];

    const dataRows = csvRawLines.slice(1);
    return dataRows.map((row) => {
      let nome = '';
      let contato = '';
      let email = '';
      let confirmacao: 'Confirmado' | 'Pendente' | 'Convite entregue' | 'Não vai' = 'Pendente';
      const extractedTags: string[] = [];

      row.forEach((cellVal, idx) => {
        const colConfig = csvHeaders[idx];
        if (!colConfig || !cellVal) return;
        const val = cellVal.trim();
        if (!val || val.toLowerCase() === 'nenhum') return;

        if (colConfig.role === 'nome' && !nome) {
          nome = val;
        } else if (colConfig.role === 'contato' && !contato) {
          contato = val;
        } else if (colConfig.role === 'email' && !email) {
          email = val;
        } else if (colConfig.role === 'confirmacao') {
          const vLower = val.toLowerCase();
          if (vLower.includes('entregue')) confirmacao = 'Convite entregue';
          else if (vLower.includes('confir') || vLower === 'sim') confirmacao = 'Confirmado';
          else if (vLower.includes('não') || vLower.includes('nao')) confirmacao = 'Não vai';
          else confirmacao = 'Pendente';
        } else if (colConfig.role === 'tag') {
          const subTags = val.split(',').map(s => s.trim()).filter(s => s.length > 0 && s.toLowerCase() !== 'nenhum');
          subTags.forEach(t => {
            if (!extractedTags.includes(t)) extractedTags.push(t);
          });
        }
      });

      return {
        nome: nome || 'Sem Nome',
        contato: contato || '',
        email: email || '',
        confirmacao,
        tags: extractedTags.length > 0 ? extractedTags : ['Geral']
      };
    }).filter(c => c.nome !== 'Sem Nome');
  });

  async function executarImportacaoCSV() {
    if (!casamentoState.casamentoAtivo) {
      alert('Selecione um casamento antes de importar.');
      return;
    }

    const casamentoId = casamentoState.casamentoAtivo.id;
    csvImporting = true;

    try {
      const novosConvidados: Convidado[] = [];
      const novasTagsParaAdicionar = new Set<string>();

      for (const item of csvPreviewConvidados) {
        const emailValido = (item.email && item.email !== '-' && item.email.includes('@')) ? item.email.trim() : '';
        const contatoValido = item.contato ? item.contato.trim() : '';

        const pbRecord = await pb.collection('convidados').create({
          casamento: casamentoId,
          nome: item.nome,
          contato: contatoValido,
          email: emailValido,
          confirmacao: item.confirmacao,
          tags: item.tags,
          is_acompanhante: false
        });

        item.tags.forEach(t => novasTagsParaAdicionar.add(t));

        novosConvidados.push({
          id: pbRecord.id,
          nome: item.nome,
          contato: item.contato,
          email: item.email,
          confirmacao: item.confirmacao,
          tags: item.tags,
          isAcompanhante: false,
          customFields: {}
        });
      }

      novasTagsParaAdicionar.forEach(t => {
        if (!tagsDisponiveis.includes(t)) {
          tagsDisponiveis = [...tagsDisponiveis, t];
        }
      });

      convidados = [...novosConvidados, ...convidados];
      isCsvModalOpen = false;
      csvStep = 'file';
      alert(`🎉 Sucesso! ${novosConvidados.length} convidados importados para o casamento.`);
    } catch (err: any) {
      console.error('Erro detalhado da importação:', err);
      let msgDetahar = '';
      if (err.data?.data) {
        msgDetahar = Object.entries(err.data.data)
          .map(([k, v]: any) => `${k}: ${v.message}`)
          .join('\n');
      }
      alert('Erro durante a importação:\n' + (msgDetahar || err.message));
    } finally {
      csvImporting = false;
    }
  }

  /* ----------------------------------------------------
     DERIVADOS REATIVOS COM SVELTE 5 ($derived)
  ---------------------------------------------------- */
  let convidadosFiltrados = $derived(
    convidados.filter((c) => {
      const matchBusca = busca.trim() === '' ||
                         c.nome.toLowerCase().includes(busca.toLowerCase()) ||
                         c.contato.includes(busca) ||
                         (c.email && c.email.toLowerCase().includes(busca.toLowerCase())) ||
                         c.tags.some(t => t.toLowerCase().includes(busca.toLowerCase()));

      const matchStatus = filtroStatus === 'Todos' || c.confirmacao === filtroStatus;
      const matchTags = tagsFiltroAtivas.length === 0 ||
                        tagsFiltroAtivas.some(t => c.tags.includes(t));

      return matchBusca && matchStatus && matchTags;
    })
  );

  // Grupos por Tag para modo Agrupado
  let gruposDeTags = $derived.by(() => {
    if (!isAgrupadoPorTag) return [];

    const map = new Map<string, Convidado[]>();

    convidadosFiltrados.forEach(c => {
      if (c.tags.length === 0) {
        const list = map.get('Sem Tag') || [];
        list.push(c);
        map.set('Sem Tag', list);
      } else {
        c.tags.forEach(t => {
          const list = map.get(t) || [];
          list.push(c);
          map.set(t, list);
        });
      }
    });

    return Array.from(map.entries()).map(([tag, list]) => ({
      tag,
      convidados: list
    }));
  });

  let totalConvidados = $derived(convidados.length);
  let totalConfirmados = $derived(convidados.filter(c => c.confirmacao === 'Confirmado').length);
  let totalEntregues = $derived(convidados.filter(c => c.confirmacao === 'Convite entregue').length);
  let totalPendentes = $derived(convidados.filter(c => c.confirmacao === 'Pendente').length);
  let totalNaoVao = $derived(convidados.filter(c => c.confirmacao === 'Não vai').length);

  let possiveisPrincipais = $derived(
    convidados.filter(c => c.id !== editingGuestId)
  );

  function getNomeConvidado(id?: string): string {
    if (!id) return '';
    const convidado = convidados.find(c => c.id === id);
    return convidado ? convidado.nome : '';
  }

  function countConvidadosPorTag(tag: string): number {
    return convidados.filter(c => c.tags.includes(tag)).length;
  }

  function toggleFiltroTag(tag: string) {
    if (tagsFiltroAtivas.includes(tag)) {
      tagsFiltroAtivas = tagsFiltroAtivas.filter(t => t !== tag);
    } else {
      tagsFiltroAtivas = [...tagsFiltroAtivas, tag];
    }
  }

  function limparFiltroTags() {
    tagsFiltroAtivas = [];
  }

  function limparFiltros() {
    busca = '';
    filtroStatus = 'Todos';
    tagsFiltroAtivas = [];
  }

  /* ----------------------------------------------------
     GERENCIAMENTO DE COLUNAS
  ---------------------------------------------------- */
  function toggleColuna(id: string) {
    colunas = colunas.map(c => c.id === id ? { ...c, visivel: !c.visivel } : c);
  }

  function handleAdicionarColuna(e: Event) {
    e.preventDefault();
    if (!novaColunaNome.trim()) return;

    const colId = 'col_' + Date.now();
    const novaCol: ColunaConfig = {
      id: colId,
      label: novaColunaNome.trim(),
      visivel: true,
      custom: true
    };

    colunas = [...colunas, novaCol];
    novaColunaNome = '';
  }

  function handleRemoverColuna(id: string) {
    if (confirm('Tem certeza que deseja remover esta coluna personalizada?')) {
      colunas = colunas.filter(c => c.id !== id);
    }
  }

  /* ----------------------------------------------------
     GERENCIAMENTO DE TAGS
  ---------------------------------------------------- */
  function handleCriarNovaTag(e: Event) {
    e.preventDefault();
    const tagLimpa = novaTagNome.trim();
    if (!tagLimpa) return;

    if (!tagsDisponiveis.includes(tagLimpa)) {
      tagsDisponiveis = [...tagsDisponiveis, tagLimpa];
    }
    if (!formTags.includes(tagLimpa)) {
      formTags = [...formTags, tagLimpa];
    }
    novaTagNome = '';
  }

  function startEditarTag(tag: string) {
    tagEmEdicao = tag;
    tagNovoNomeEdicao = tag;
  }

  async function salvarEdicaoTag(tagAntiga: string) {
    const novoNomeTag = tagNovoNomeEdicao.trim();
    if (!novoNomeTag || novoNomeTag === tagAntiga) {
      tagEmEdicao = null;
      return;
    }

    const convidadosComTag = convidados.filter(c => c.tags.includes(tagAntiga));

    tagsDisponiveis = tagsDisponiveis.map(t => t === tagAntiga ? novoNomeTag : t);
    convidados = convidados.map(c => ({
      ...c,
      tags: c.tags.map(t => t === tagAntiga ? novoNomeTag : t)
    }));
    formTags = formTags.map(t => t === tagAntiga ? novoNomeTag : t);
    tagsFiltroAtivas = tagsFiltroAtivas.map(t => t === tagAntiga ? novoNomeTag : t);
    tagEmEdicao = null;

    for (const c of convidadosComTag) {
      const novasTags = c.tags.map(t => t === tagAntiga ? novoNomeTag : t);
      try {
        await pb.collection('convidados').update(c.id, { tags: novasTags });
      } catch (e) {}
    }
  }

  async function handleExcluirTag(tagParaExcluir: string) {
    if (confirm(`Tem certeza que deseja excluir a tag "${tagParaExcluir}" de todo o sistema?`)) {
      const convidadosComTag = convidados.filter(c => c.tags.includes(tagParaExcluir));

      tagsDisponiveis = tagsDisponiveis.filter(t => t !== tagParaExcluir);
      convidados = convidados.map(c => ({
        ...c,
        tags: c.tags.filter(t => t !== tagParaExcluir)
      }));
      formTags = formTags.filter(t => t !== tagParaExcluir);
      tagsFiltroAtivas = tagsFiltroAtivas.filter(t => t !== tagParaExcluir);

      for (const c of convidadosComTag) {
        const novasTags = c.tags.filter(t => t !== tagParaExcluir);
        try {
          await pb.collection('convidados').update(c.id, { tags: novasTags });
        } catch (e) {}
      }
    }
  }

  function toggleTagSelecao(tag: string) {
    if (formTags.includes(tag)) {
      formTags = formTags.filter(t => t !== tag);
    } else {
      formTags = [...formTags, tag];
    }
  }

  /* ----------------------------------------------------
     MODAL DE CONVIDADO (CRIAR E EDITAR)
  ---------------------------------------------------- */
  function handleOpenModalCreate() {
    editingGuestId = null;
    resetForm();
    isModalOpen = true;
  }

  function handleOpenModalEdit(convidado: Convidado) {
    editingGuestId = convidado.id;
    formNome = convidado.nome;
    formContato = convidado.contato;
    formEmail = convidado.email;
    formConfirmacao = convidado.confirmacao;
    formTags = [...convidado.tags];
    formIsAcompanhante = convidado.isAcompanhante;
    formConvidadoPrincipalId = convidado.convidadoPrincipalId || '';
    formCustomFields = { ...(convidado.customFields || {}) };
    isModalOpen = true;
  }

  function handleCloseModal() {
    isModalOpen = false;
    editingGuestId = null;
    resetForm();
  }

  function resetForm() {
    formNome = '';
    formContato = '';
    formEmail = '';
    formConfirmacao = 'Pendente';
    formTags = [];
    formIsAcompanhante = false;
    formConvidadoPrincipalId = '';
    formCustomFields = {};
  }

  async function handleSalvarConvidado(e: SubmitEvent) {
    e.preventDefault();
    if (!formNome.trim()) return;

    if (!casamentoState.casamentoAtivo) {
      alert('Você precisa ter um casamento selecionado.');
      return;
    }

    const casamentoId = casamentoState.casamentoAtivo.id;

    if (editingGuestId) {
      try {
        await pb.collection('convidados').update(editingGuestId, {
          nome: formNome.trim(),
          contato: formContato.trim(),
          email: formEmail.trim(),
          confirmacao: formConfirmacao,
          tags: formTags,
          is_acompanhante: formIsAcompanhante,
          convidado_principal: formIsAcompanhante ? formConvidadoPrincipalId : null,
          custom_fields: formCustomFields
        });

        convidados = convidados.map(c => {
          if (c.id === editingGuestId) {
            return {
              ...c,
              nome: formNome.trim(),
              contato: formContato.trim(),
              email: formEmail.trim(),
              confirmacao: formConfirmacao,
              tags: formTags.length > 0 ? [...formTags] : ['Geral'],
              isAcompanhante: formIsAcompanhante,
              convidadoPrincipalId: formIsAcompanhante ? formConvidadoPrincipalId : undefined,
              customFields: { ...formCustomFields }
            };
          }
          return c;
        });
      } catch (err: any) {
        alert('Erro ao atualizar convidado no PocketBase: ' + err.message);
      }
    } else {
      try {
        const pbRecord = await pb.collection('convidados').create({
          casamento: casamentoId,
          nome: formNome.trim(),
          contato: formContato.trim(),
          email: formEmail.trim(),
          confirmacao: formConfirmacao,
          tags: formTags,
          is_acompanhante: formIsAcompanhante,
          convidado_principal: formIsAcompanhante ? formConvidadoPrincipalId : null,
          custom_fields: formCustomFields
        });

        const novoRegistro: Convidado = {
          id: pbRecord.id,
          nome: formNome.trim(),
          contato: formContato.trim(),
          email: formEmail.trim(),
          confirmacao: formConfirmacao,
          tags: formTags.length > 0 ? [...formTags] : ['Geral'],
          isAcompanhante: formIsAcompanhante,
          convidadoPrincipalId: formIsAcompanhante ? formConvidadoPrincipalId : undefined,
          customFields: { ...formCustomFields }
        };

        convidados = [...convidados, novoRegistro];
      } catch (err: any) {
        alert('Erro ao adicionar convidado no PocketBase: ' + err.message);
      }
    }

    handleCloseModal();
  }

  async function handleExcluirConvidado(id: string, nome: string) {
    if (confirm(`Tem certeza que deseja remover ${nome} da lista?`)) {
      try {
        await pb.collection('convidados').delete(id);
        convidados = convidados.filter(c => c.id !== id);
      } catch (err: any) {
        alert('Erro ao excluir convidado: ' + err.message);
      }
    }
  }

  async function handleMudarStatus(id: string, novoStatus: 'Confirmado' | 'Pendente' | 'Convite entregue' | 'Não vai') {
    try {
      await pb.collection('convidados').update(id, { confirmacao: novoStatus });
      convidados = convidados.map(c => c.id === id ? { ...c, confirmacao: novoStatus } : c);
    } catch (err: any) {
      alert('Erro ao alterar status: ' + err.message);
    }
  }

  function handleAtualizarCustomField(convidadoId: string, colId: string, valor: string) {
    convidados = convidados.map(c => {
      if (c.id === convidadoId) {
        return {
          ...c,
          customFields: {
            ...(c.customFields || {}),
            [colId]: valor
          }
        };
      }
      return c;
    });

    const convidado = convidados.find(c => c.id === convidadoId);
    if (convidado) {
      pb.collection('convidados').update(convidadoId, {
        custom_fields: convidado.customFields
      }).catch(console.error);
    }
  }

  onMount(async () => {
    if (auth.isValid && auth.user) {
      await casamentoState.carregarCasamentosDoUsuario(auth.user.id);
      if (casamentoState.casamentoAtivo) {
        await carregarConvidadosDoCasamento(casamentoState.casamentoAtivo.id);
      }
    }
  });
</script>

<svelte:head>
  <title>Gerenciador de Casamento — Convidados & Multi-Tenant</title>
</svelte:head>

<!-- ====================================================
     ESTADO 1: TELA DE LOGIN INICIAL (NÃO LOGADO)
==================================================== -->
{#if !auth.isValid}
  <div class="login-page-container">
    <div class="header-ornament">
      <span class="gold-line"></span>
      <span class="diamond">◆</span>
      <span class="gold-line"></span>
    </div>

    <div class="login-card">
      <div class="login-card-header">
        <h1>Gerenciador de Casamento</h1>
        <p class="login-subtitle">
          Acesse sua conta para visualizar e gerenciar o conjunto do seu evento com segurança.
        </p>
      </div>

      <form onsubmit={handleLogin} class="main-login-form">
        <div class="form-group">
          <label for="login-email">E-mail de Acesso</label>
          <input
            id="login-email"
            type="email"
            placeholder="exemplo@email.com"
            bind:value={loginEmail}
            required
          />
        </div>

        <div class="form-group">
          <label for="login-password">Senha</label>
          <input
            id="login-password"
            type="password"
            placeholder="Sua senha"
            bind:value={loginPassword}
            required
          />
        </div>

        {#if authError}
          <div class="auth-error-alert">{authError}</div>
        {/if}

        <button type="submit" class="btn-primary btn-full" disabled={authLoading}>
          {authLoading ? 'Entrando...' : '🔑 Entrar no Sistema'}
        </button>

        <div class="demo-credentials-box">
          <span>💡 Dica de Teste Rápido:</span>
          <code>user@teste.com</code> / <code>senha123456</code>
          <button type="button" class="btn-quick-fill" onclick={preencherTeste}>
            Preencher credenciais de teste
          </button>
        </div>
      </form>
    </div>
  </div>

<!-- ====================================================
     ESTADO 2: SELEÇÃO / CRIAÇÃO DE SET DE CASAMENTO
==================================================== -->
{:else if auth.isValid && (!casamentoState.casamentoAtivo || isCriandoNovoSet)}
  <div class="login-page-container">
    <div class="header-ornament">
      <span class="gold-line"></span>
      <span class="diamond">◆</span>
      <span class="gold-line"></span>
    </div>

    <div class="login-card set-creation-card">
      <div class="user-welcome-header">
        <span class="badge-user">👤 Logado como: <strong>{auth.user?.email || ''}</strong></span>
        <button class="btn-logout" onclick={handleLogout}>🚪 Sair</button>
      </div>

      {#if casamentoState.casamentosDoUsuario.length > 0 && !isCriandoNovoSet}
        <div class="set-select-section">
          <h2>Seus Conjuntos de Casamento</h2>
          <p class="section-desc">Selecione o casamento que deseja gerenciar hoje:</p>

          <div class="wedding-sets-list">
            {#each casamentoState.casamentosDoUsuario as c}
              <button
                class="wedding-set-item {casamentoState.casamentoAtivo?.id === c.id ? 'active' : ''}"
                onclick={() => handleSelecionarCasamento(c)}
              >
                <div class="set-title-row">
                  <span class="set-icon">💍</span>
                  <strong class="set-title">{c.titulo}</strong>
                </div>
                <span class="btn-enter-set">Acessar Módulo ➔</span>
              </button>
            {/each}
          </div>

          <div class="or-divider">
            <span>ou</span>
          </div>

          <button class="btn-secondary btn-full" onclick={() => isCriandoNovoSet = true}>
            + Criar Novo Conjunto de Casamento
          </button>
        </div>
      {:else}
        <div class="set-creation-form">
          <h2>Criar Novo Conjunto de Casamento</h2>
          <p class="section-desc">Informe o título do seu grande dia para dar início à gestão de convidados.</p>

          <form onsubmit={handleCriarNovoCasamento} class="main-login-form">
            <div class="form-group">
              <label for="titulo-set">Título do Evento / Casamento *</label>
              <input
                id="titulo-set"
                type="text"
                placeholder="Ex: Casamento de Lucas & Maria"
                bind:value={novoSetTitulo}
                required
              />
            </div>

            <div class="form-group">
              <label for="data-set">Data do Evento (Opcional)</label>
              <input
                id="data-set"
                type="date"
                bind:value={novoSetData}
              />
            </div>

            {#if setCreatingError}
              <div class="auth-error-alert">{setCreatingError}</div>
            {/if}

            <div class="modal-actions">
              {#if casamentoState.casamentosDoUsuario.length > 0}
                <button type="button" class="btn-secondary" onclick={() => isCriandoNovoSet = false}>
                  Voltar para seleção
                </button>
              {/if}
              <button type="submit" class="btn-primary" disabled={setCreatingLoading}>
                {setCreatingLoading ? 'Criando...' : '💍 Criar Casamento e Acessar Módulo'}
              </button>
            </div>
          </form>
        </div>
      {/if}
    </div>
  </div>

<!-- ====================================================
     ESTADO 3: MÓDULO DE CONVIDADOS ISOLADO
==================================================== -->
{:else}
  <div class="page-container">
    <div class="tenant-banner">
      <div class="tenant-info">
        <span class="wedding-badge">
          💍 <strong>{casamentoState.casamentoAtivo?.titulo || 'Casamento'}</strong>
        </span>
        <span class="tenant-tag">Ambiente Isolado do Usuário</span>
      </div>

      <div class="auth-bar">
        <div class="user-logged-info">
          <span class="user-email">👤 <strong>{auth.user?.email || ''}</strong></span>

          {#if casamentoState.casamentosDoUsuario.length > 1 || isCriandoNovoSet === false}
            <button
              class="btn-secondary btn-sm"
              onclick={() => { casamentoState.casamentoAtivo = null; isCriandoNovoSet = false; }}
            >
              🔄 Trocar / Novo Casamento
            </button>
          {/if}

          <button class="btn-logout" onclick={handleLogout}>🚪 Sair</button>
        </div>
      </div>
    </div>

    <div class="header-ornament">
      <span class="gold-line"></span>
      <span class="diamond">◆</span>
      <span class="gold-line"></span>
    </div>

    <header class="header-section">
      <div class="title-group">
        <h1>Convidados</h1>
        <p class="subtitle">
          Gerencie sua lista de convidados para o <strong>{casamentoState.casamentoAtivo?.titulo || 'seu casamento'}</strong> com acompanhantes vinculados e reordenação drag and drop.
        </p>
      </div>

      <div class="header-actions">
        <!-- Botão de Ordenar A-Z -->
        <button class="btn-secondary" onclick={ordenarAlfaAZ} title="Ordenar lista alfabeticamente por Nome">
          🔤 Ordenar (A-Z)
        </button>

        <!-- Botão de Agrupar por Tags -->
        <button
          class="btn-secondary {isAgrupadoPorTag ? 'active-group-btn' : ''}"
          onclick={() => isAgrupadoPorTag = !isAgrupadoPorTag}
          title="Agrupar visualmente a tabela por categorias de Tags"
        >
          🏷️ {isAgrupadoPorTag ? 'Desagrupar Tags' : 'Agrupar por Tags'}
        </button>

        <!-- Botão de Importar CSV -->
        <button class="btn-secondary" onclick={() => { isCsvModalOpen = true; csvStep = 'file'; }}>
          📥 Importar CSV
        </button>

        <button class="btn-primary" onclick={handleOpenModalCreate}>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>Adicionar convidado</span>
        </button>
      </div>
    </header>

    <!-- Metrics Cards Atualizados -->
    <div class="metrics-grid">
      <div class="metric-card">
        <span class="metric-label">Total de Convidados</span>
        <span class="metric-value">{totalConvidados}</span>
      </div>
      <div class="metric-card confirmados">
        <span class="metric-label">Confirmados</span>
        <span class="metric-value">{totalConfirmados}</span>
      </div>
      <div class="metric-card entregues">
        <span class="metric-label">Convites Entregues</span>
        <span class="metric-value">{totalEntregues}</span>
      </div>
      <div class="metric-card pendentes">
        <span class="metric-label">Pendentes</span>
        <span class="metric-value">{totalPendentes}</span>
      </div>
      <div class="metric-card ausentes">
        <span class="metric-label">Não vão</span>
        <span class="metric-value">{totalNaoVao}</span>
      </div>
    </div>

    <!-- Toolbar e Filtros por Status -->
    <div class="toolbar">
      <div class="search-box">
        <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="text"
          placeholder="Buscar convidado por nome, contato ou tag..."
          bind:value={busca}
          aria-label="Buscar convidado por nome"
        />
        {#if busca}
          <button class="btn-clear" onclick={() => busca = ''} title="Limpar busca">✕</button>
        {/if}
      </div>

      <div class="toolbar-right">
        <div class="filter-pills">
          <button
            class="pill {filtroStatus === 'Todos' ? 'active' : ''}"
            onclick={() => filtroStatus = 'Todos'}
          >
            Todos ({totalConvidados})
          </button>
          <button
            class="pill {filtroStatus === 'Confirmado' ? 'active' : ''}"
            onclick={() => filtroStatus = 'Confirmado'}
          >
            Confirmados ({totalConfirmados})
          </button>
          <button
            class="pill {filtroStatus === 'Convite entregue' ? 'active' : ''}"
            onclick={() => filtroStatus = 'Convite entregue'}
          >
            Convite entregue ({totalEntregues})
          </button>
          <button
            class="pill {filtroStatus === 'Pendente' ? 'active' : ''}"
            onclick={() => filtroStatus = 'Pendente'}
          >
            Pendentes ({totalPendentes})
          </button>
          <button
            class="pill {filtroStatus === 'Não vai' ? 'active' : ''}"
            onclick={() => filtroStatus = 'Não vai'}
          >
            Não vão ({totalNaoVao})
          </button>
        </div>

        <button class="btn-secondary" onclick={() => isTagManagerOpen = true}>
          ⚙️ Gerenciar Tags
        </button>

        <div class="columns-dropdown-wrapper">
          <button
            class="btn-secondary btn-columns"
            onclick={() => showColunasMenu = !showColunasMenu}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9-9-1.8-9-9 1.8-9 9-9z"></path>
              <path d="M12 8v8"></path>
              <path d="M8 12h8"></path>
            </svg>
            <span>Colunas</span>
          </button>

          {#if showColunasMenu}
            <div class="columns-popover" onmouseleave={() => showColunasMenu = false} role="menu" tabindex="-1" aria-label="Gerenciador de Colunas">
              <div class="popover-header">
                <span>Exibir / Ocultar Colunas</span>
                <button class="close-popover" onclick={() => showColunasMenu = false}>✕</button>
              </div>

              <div class="popover-list">
                {#each colunas as col}
                  <label class="col-checkbox-item">
                    <input
                      type="checkbox"
                      checked={col.visivel}
                      onchange={() => toggleColuna(col.id)}
                    />
                    <span>{col.label}</span>
                    {#if col.custom}
                      <button
                        class="btn-delete-col"
                        onclick={() => handleRemoverColuna(col.id)}
                        title="Excluir coluna personalizada"
                      >
                        🗑️
                      </button>
                    {/if}
                  </label>
                {/each}
              </div>

              <form onsubmit={handleAdicionarColuna} class="add-column-form">
                <input
                  type="text"
                  placeholder="Nome da nova coluna..."
                  bind:value={novaColunaNome}
                  required
                />
                <button type="submit" class="btn-add-col">+ Criar</button>
              </form>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Barra de Filtros Interativos por Tag -->
    <div class="tag-filter-strip">
      <div class="tag-strip-header">
        <span class="tag-strip-label">🏷️ Filtrar por Tag:</span>
        {#if tagsFiltroAtivas.length > 0}
          <button class="btn-reset-tags" onclick={limparFiltroTags}>
            Limpar filtro de tags ({tagsFiltroAtivas.length})
          </button>
        {/if}
      </div>
      <div class="tag-strip-pills">
        <button
          class="tag-pill-btn {tagsFiltroAtivas.length === 0 ? 'active' : ''}"
          onclick={limparFiltroTags}
        >
          Todas ({totalConvidados})
        </button>
        {#each tagsDisponiveis as tag}
          {@const count = countConvidadosPorTag(tag)}
          <button
            class="tag-pill-btn {tagsFiltroAtivas.includes(tag) ? 'active' : ''}"
            onclick={() => toggleFiltroTag(tag)}
          >
            {tagsFiltroAtivas.includes(tag) ? '✓ ' : ''}{tag} ({count})
          </button>
        {/each}
      </div>
    </div>

    <div class="counter-bar">
      <div class="counter-info">
        <span>Exibindo <strong>{convidadosFiltrados.length}</strong> de <strong>{totalConvidados}</strong> convidados</span>
        {#if busca || filtroStatus !== 'Todos' || tagsFiltroAtivas.length > 0}
          <span class="active-filters-tag">
            Filtros ativos:
            {filtroStatus !== 'Todos' ? `Status: ${filtroStatus}` : ''}
            {tagsFiltroAtivas.length > 0 ? ` | Tags: ${tagsFiltroAtivas.join(', ')}` : ''}
            {busca ? ` | Busca: "${busca}"` : ''}
          </span>
          <button class="btn-reset-filters" onclick={limparFiltros}>Limpar tudo</button>
        {/if}
      </div>
    </div>

    <!-- Tabela Dinâmica de Convidados com Drag and Drop & Agrupamento por Tags -->
    <div class="table-container">
      {#if convidadosFiltrados.length === 0}
        <div class="empty-state">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#C44569" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <h3>Nenhum convidado cadastrado neste casamento</h3>
          <p>Você ainda não possui convidados nesta lista ou os filtros ativos omitiram os registros.</p>
          {#if busca || filtroStatus !== 'Todos' || tagsFiltroAtivas.length > 0}
            <button class="btn-secondary" onclick={limparFiltros}>
              Limpar Filtros
            </button>
          {/if}
        </div>

      {:else if isAgrupadoPorTag}
        <!-- MODO AGRUPADO POR TAGS -->
        <div class="tag-grouped-container">
          {#each gruposDeTags as grupo}
            <div class="tag-group-section">
              <div class="tag-group-header">
                <span class="tag-group-title">🏷️ {grupo.tag} ({grupo.convidados.length})</span>
              </div>

              <table class="guest-table">
                <thead>
                  <tr>
                    <th class="col-num-header">#</th>
                    <th>Nome</th>
                    {#each colunas as col}
                      {#if col.visivel}
                        <th class={col.id === 'acoes' ? 'text-right' : ''}>{col.label}</th>
                      {/if}
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each grupo.convidados as convidado, index (convidado.id)}
                    <tr class={convidado.isAcompanhante ? 'row-acompanhante' : ''}>
                      <td class="col-num">
                        <span class="row-number">{index + 1}</span>
                      </td>
                      <td class="col-nome">
                        <div class="name-info">
                          <span class="guest-name">{convidado.nome}</span>
                          {#if convidado.isAcompanhante}
                            <span class="subtag-badge">Acompanhante</span>
                          {/if}
                        </div>
                      </td>

                      {#each colunas as col}
                        {#if col.visivel}
                          {#if col.id === 'contato'}
                            <td class="col-contato">
                              <div class="contact-box">
                                <span class="phone">{convidado.contato}</span>
                                {#if convidado.email}
                                  <span class="email">{convidado.email}</span>
                                {/if}
                              </div>
                            </td>
                          {:else if col.id === 'confirmacao'}
                            <td class="col-confirmacao">
                              <select
                                class="status-badge status-{convidado.confirmacao.toLowerCase().replace(/ /g, '-')}"
                                value={convidado.confirmacao}
                                onchange={(e) => handleMudarStatus(convidado.id, e.currentTarget.value as any)}
                              >
                                <option value="Pendente">● Pendente</option>
                                <option value="Convite entregue">✉️ Convite entregue</option>
                                <option value="Confirmado">✓ Confirmado</option>
                                <option value="Não vai">✕ Não vai</option>
                              </select>
                            </td>
                          {:else if col.id === 'tags'}
                            <td class="col-tags">
                              <div class="tags-wrapper">
                                {#each convidado.tags as tag}
                                  <span class="tag-pill">{tag}</span>
                                {/each}
                              </div>
                            </td>
                          {:else if col.id === 'acompanhante'}
                            <td class="col-acompanhante">
                              {#if convidado.isAcompanhante}
                                <span class="companion-badge secondary" title="Convidado acompanhante">
                                  Sim, de <strong>{getNomeConvidado(convidado.convidadoPrincipalId) || 'Convidado Principal'}</strong>
                                </span>
                              {/if}
                            </td>
                          {:else if col.id === 'acoes'}
                            <td class="col-acoes text-right">
                              <div class="actions-group">
                                <button class="action-btn edit-btn" onclick={() => handleOpenModalEdit(convidado)} title="Editar convidado">
                                  ✏️
                                </button>
                                <button class="action-btn delete-btn" onclick={() => handleExcluirConvidado(convidado.id, convidado.nome)} title="Excluir convidado">
                                  🗑️
                                </button>
                              </div>
                            </td>
                          {:else if col.custom}
                            <td class="col-custom">
                              <input
                                type="text"
                                class="custom-cell-input"
                                placeholder="Informe o valor..."
                                value={convidado.customFields[col.id] || ''}
                                onblur={(e) => handleAtualizarCustomField(convidado.id, col.id, e.currentTarget.value)}
                              />
                            </td>
                          {/if}
                        {/if}
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        </div>

      {:else}
        <!-- MODO PADRÃO DE LISTAGEM COM DRAG AND DROP REORDERING -->
        <table class="guest-table">
          <thead>
            <tr>
              <th class="col-num-header">#</th>
              <th>Nome</th>

              {#each colunas as col}
                {#if col.visivel}
                  <th class={col.id === 'acoes' ? 'text-right' : ''}>{col.label}</th>
                {/if}
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each convidadosFiltrados as convidado, index (convidado.id)}
              <tr
                draggable="true"
                ondragstart={(e) => handleDragStart(e, index)}
                ondragover={handleDragOver}
                ondrop={(e) => handleDrop(e, index)}
                class="{convidado.isAcompanhante ? 'row-acompanhante' : ''} {draggedIndex === index ? 'row-dragging' : ''}"
              >
                <!-- Numeração Sequencial com Alça Drag & Drop -->
                <td class="col-num">
                  <div class="drag-handle-box">
                    <span class="drag-handle" title="Arrastar para reordenar">⋮⋮</span>
                    <span class="row-number">{index + 1}</span>
                  </div>
                </td>

                <td class="col-nome">
                  <div class="name-info">
                    <span class="guest-name">{convidado.nome}</span>
                    {#if convidado.isAcompanhante}
                      <span class="subtag-badge">Acompanhante</span>
                    {/if}
                  </div>
                </td>

                {#each colunas as col}
                  {#if col.visivel}
                    {#if col.id === 'contato'}
                      <td class="col-contato">
                        <div class="contact-box">
                          <span class="phone">{convidado.contato}</span>
                          {#if convidado.email}
                            <span class="email">{convidado.email}</span>
                          {/if}
                        </div>
                      </td>
                    {:else if col.id === 'confirmacao'}
                      <td class="col-confirmacao">
                        <select
                          class="status-badge status-{convidado.confirmacao.toLowerCase().replace(/ /g, '-')}"
                          value={convidado.confirmacao}
                          onchange={(e) => handleMudarStatus(convidado.id, e.currentTarget.value as any)}
                        >
                          <option value="Pendente">● Pendente</option>
                          <option value="Convite entregue">✉️ Convite entregue</option>
                          <option value="Confirmado">✓ Confirmado</option>
                          <option value="Não vai">✕ Não vai</option>
                        </select>
                      </td>
                    {:else if col.id === 'tags'}
                      <td class="col-tags">
                        <div class="tags-wrapper">
                          {#each convidado.tags as tag}
                            <span class="tag-pill">{tag}</span>
                          {/each}
                        </div>
                      </td>
                    {:else if col.id === 'acompanhante'}
                      <td class="col-acompanhante">
                        {#if convidado.isAcompanhante}
                          <span class="companion-badge secondary" title="Convidado acompanhante">
                            Sim, de <strong>{getNomeConvidado(convidado.convidadoPrincipalId) || 'Convidado Principal'}</strong>
                          </span>
                        {/if}
                      </td>
                    {:else if col.id === 'acoes'}
                      <td class="col-acoes text-right">
                        <div class="actions-group">
                          <button
                            class="action-btn edit-btn"
                            onclick={() => handleOpenModalEdit(convidado)}
                            title="Editar convidado"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                          </button>

                          <button
                            class="action-btn delete-btn"
                            onclick={() => handleExcluirConvidado(convidado.id, convidado.nome)}
                            title="Excluir convidado"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </td>
                    {:else if col.custom}
                      <td class="col-custom">
                        <input
                          type="text"
                          class="custom-cell-input"
                          placeholder="Informe o valor..."
                          value={convidado.customFields[col.id] || ''}
                          onblur={(e) => handleAtualizarCustomField(convidado.id, col.id, e.currentTarget.value)}
                        />
                      </td>
                    {/if}
                  {/if}
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
{/if}

<!-- MODAL DE IMPORTAÇÃO INTERATIVA DE CSV -->
{#if isCsvModalOpen}
  <div
    class="modal-backdrop"
    onclick={() => isCsvModalOpen = false}
    onkeydown={(e) => e.key === 'Escape' && (isCsvModalOpen = false)}
    role="button"
    tabindex="0"
  >
    <div
      class="modal-card csv-modal-card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-modal-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="csv-modal-title">📥 Importar Lista via CSV</h2>
        <button class="modal-close" onclick={() => isCsvModalOpen = false}>✕</button>
      </div>

      <div class="csv-modal-body">
        {#if csvStep === 'file'}
          <div class="file-upload-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#8C1D40" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <h3>Selecione seu Arquivo CSV</h3>
            <p>Selecione a planilha `.csv` de convidados (ex: arquivo do Notion ou Excel).</p>

            <label class="btn-primary file-input-label">
              <span>Escolher Arquivo CSV</span>
              <input type="file" accept=".csv" onchange={handleFileSelected} />
            </label>
          </div>

        {:else if csvStep === 'map'}
          <div class="csv-step-header">
            <h3>⚙️ Mapeamento de Colunas</h3>
            <p>Defina o papel de cada coluna encontrada no seu arquivo CSV:</p>
          </div>

          <div class="csv-columns-mapping-list">
            {#each csvHeaders as col, idx}
              <div class="csv-col-mapping-card">
                <div class="col-info">
                  <span class="col-name"><strong>{col.name}</strong></span>
                  {#if col.sample}
                    <span class="col-sample">Exemplo: "{col.sample}"</span>
                  {/if}
                </div>

                <div class="col-role-select">
                  <select bind:value={col.role}>
                    <option value="nome">👤 Nome do Convidado</option>
                    <option value="tag">🏷️ Importar valores como Tags</option>
                    <option value="contato">📞 Contato / Telefone</option>
                    <option value="email">✉️ E-mail</option>
                    <option value="confirmacao">● Status de Confirmação</option>
                    <option value="ignorar">🚫 Ignorar esta coluna</option>
                  </select>
                </div>
              </div>
            {/each}
          </div>

          <div class="modal-actions">
            <button class="btn-secondary" onclick={() => csvStep = 'file'}>
              Voltar
            </button>
            <button class="btn-primary" onclick={() => csvStep = 'preview'}>
              Ver Pré-visualização ({csvPreviewConvidados.length} Convidados) ➔
            </button>
          </div>

        {:else if csvStep === 'preview'}
          <div class="csv-step-header">
            <h3>🔍 Pré-visualização dos Convidados</h3>
            <p>Confira os nomes e as tags que foram mapeadas antes de confirmar:</p>
          </div>

          <div class="csv-preview-table-container">
            <table class="guest-table preview-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Contato</th>
                  <th>Status</th>
                  <th>Tags Mapeadas</th>
                </tr>
              </thead>
              <tbody>
                {#each csvPreviewConvidados.slice(0, 8) as item}
                  <tr>
                    <td><strong>{item.nome}</strong></td>
                    <td>{item.contato}</td>
                    <td><span class="status-badge status-{item.confirmacao.toLowerCase().replace(/ /g, '-')}">{item.confirmacao}</span></td>
                    <td>
                      <div class="tags-wrapper">
                        {#each item.tags as t}
                          <span class="tag-pill">{t}</span>
                        {/each}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if csvPreviewConvidados.length > 8}
            <p class="preview-more-info">... e mais {csvPreviewConvidados.length - 8} convidados prontos para serem importados.</p>
          {/if}

          <div class="modal-actions">
            <button class="btn-secondary" onclick={() => csvStep = 'map'}>
              Voltar para Mapeamento
            </button>
            <button class="btn-primary" onclick={executarImportacaoCSV} disabled={csvImporting}>
              {csvImporting ? 'Importando no PocketBase...' : `🚀 Importar ${csvPreviewConvidados.length} Convidados`}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- MODAL PARA ADICIONAR / EDITAR CONVIDADO -->
{#if isModalOpen}
  <div
    class="modal-backdrop"
    onclick={handleCloseModal}
    onkeydown={(e) => e.key === 'Escape' && handleCloseModal()}
    role="button"
    tabindex="0"
  >
    <div
      class="modal-card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="modal-title">
          {editingGuestId ? 'Editar Convidado' : 'Adicionar Convidado'}
        </h2>
        <button class="modal-close" onclick={handleCloseModal} aria-label="Fechar modal">✕</button>
      </div>

      <form onsubmit={handleSalvarConvidado} class="modal-form">
        <div class="form-group">
          <label for="nome">Nome Completo *</label>
          <input
            id="nome"
            type="text"
            placeholder="Ex: Mariana Souza"
            bind:value={formNome}
            required
          />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="contato">Telefone / WhatsApp</label>
            <input
              id="contato"
              type="text"
              placeholder="(11) 99999-9999"
              bind:value={formContato}
            />
          </div>

          <div class="form-group">
            <label for="email">E-mail</label>
            <input
              id="email"
              type="email"
              placeholder="exemplo@email.com"
              bind:value={formEmail}
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="confirmacao">Status de Confirmação</label>
            <select id="confirmacao" bind:value={formConfirmacao}>
              <option value="Pendente">● Pendente</option>
              <option value="Convite entregue">✉️ Convite entregue</option>
              <option value="Confirmado">✓ Confirmado</option>
              <option value="Não vai">✕ Não vai</option>
            </select>
          </div>
        </div>

        <div class="form-group companion-config-box">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={formIsAcompanhante} />
            <span>Este convidado é acompanhante de outra pessoa?</span>
          </label>

          {#if formIsAcompanhante}
            <div class="select-principal-box">
              <label for="select-principal">Selecionar Convidado Principal *</label>
              <select id="select-principal" bind:value={formConvidadoPrincipalId} required={formIsAcompanhante}>
                <option value="" disabled>-- Selecione quem está levando este convidado --</option>
                {#each possiveisPrincipais as p}
                  <option value={p.id}>{p.nome}</option>
                {/each}
              </select>
            </div>
          {/if}
        </div>

        <div class="form-group">
          <span class="label-title">Tags do Convidado</span>
          <div class="tag-selector-box">
            {#each tagsDisponiveis as tag}
              <button
                type="button"
                class="tag-toggle-btn {formTags.includes(tag) ? 'selected' : ''}"
                onclick={() => toggleTagSelecao(tag)}
              >
                {formTags.includes(tag) ? '✓ ' : '+ '}{tag}
              </button>
            {/each}
          </div>

          <div class="add-tag-row">
            <input
              type="text"
              placeholder="Criar nova tag personalizada..."
              bind:value={novaTagNome}
            />
            <button type="button" class="btn-secondary" onclick={handleCriarNovaTag}>
              + Tag
            </button>
          </div>
        </div>

        {#each colunas as col}
          {#if col.custom}
            <div class="form-group">
              <label for={col.id}>{col.label}</label>
              <input
                id={col.id}
                type="text"
                placeholder="Informação para {col.label}..."
                value={formCustomFields[col.id] || ''}
                oninput={(e) => formCustomFields[col.id] = e.currentTarget.value}
              />
            </div>
          {/if}
        {/each}

        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={handleCloseModal}>
            Cancelar
          </button>
          <button type="submit" class="btn-primary">
            {editingGuestId ? 'Salvar Alterações' : 'Adicionar Convidado'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- MODAL PARA EDITAR E EXCLUIR TAGS GLOBAIS -->
{#if isTagManagerOpen}
  <div
    class="modal-backdrop"
    onclick={() => isTagManagerOpen = false}
    onkeydown={(e) => e.key === 'Escape' && (isTagManagerOpen = false)}
    role="button"
    tabindex="0"
  >
    <div
      class="modal-card"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tag-modal-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <h2 id="tag-modal-title">Gerenciador de Tags</h2>
        <button class="modal-close" onclick={() => isTagManagerOpen = false}>✕</button>
      </div>

      <div class="tag-manager-body">
        <p class="tag-manager-help">
          Edite ou remova as tags cadastradas no sistema. Alterar o nome de uma tag irá atualizá-la em todos os convidados automaticamente.
        </p>

        <div class="tag-manage-list">
          {#each tagsDisponiveis as tag}
            <div class="tag-manage-item">
              {#if tagEmEdicao === tag}
                <input
                  type="text"
                  class="tag-edit-input"
                  bind:value={tagNovoNomeEdicao}
                  onkeydown={(e) => e.key === 'Enter' && salvarEdicaoTag(tag)}
                />
                <button class="btn-save-tag" onclick={() => salvarEdicaoTag(tag)}>Salvar</button>
                <button class="btn-cancel-tag" onclick={() => tagEmEdicao = null}>Cancelar</button>
              {:else}
                <span class="tag-pill">{tag}</span>
                <div class="tag-manage-actions">
                  <button class="btn-icon-tag" onclick={() => startEditarTag(tag)} title="Renomear tag">✏️</button>
                  <button class="btn-icon-tag danger" onclick={() => handleExcluirTag(tag)} title="Excluir tag">🗑️</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <form onsubmit={handleCriarNovaTag} class="add-tag-manager-form">
          <input
            type="text"
            placeholder="Nome da nova tag..."
            bind:value={novaTagNome}
            required
          />
          <button type="submit" class="btn-primary">+ Criar Tag</button>
        </form>
      </div>
    </div>
  </div>
{/if}

<style>
  .page-container {
    width: 100%;
  }

  .login-page-container {
    max-width: 480px;
    margin: 3rem auto;
    padding: 0 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .login-card {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 20px;
    padding: 2.2rem 2rem;
    width: 100%;
    box-shadow: 0 12px 32px rgba(47, 24, 34, 0.08);
  }

  .login-card-header {
    text-align: center;
    margin-bottom: 1.8rem;
  }

  .login-card-header h1 {
    font-size: 2.2rem;
    color: #8C1D40;
    margin: 0 0 0.5rem 0;
  }

  .login-subtitle {
    color: #5C4A52;
    font-size: 0.92rem;
    line-height: 1.45;
    margin: 0;
  }

  .main-login-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .btn-full {
    width: 100%;
    justify-content: center;
    padding: 0.85rem;
    font-size: 0.95rem;
    margin-top: 0.5rem;
  }

  .demo-credentials-box {
    margin-top: 1.25rem;
    padding: 1rem;
    background: #FFF8F3;
    border: 1px dashed #E7D6DC;
    border-radius: 10px;
    font-size: 0.82rem;
    color: #5C4A52;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: center;
  }

  .btn-quick-fill {
    background: #FFFDFB;
    border: 1px solid #C44569;
    color: #8C1D40;
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    margin-top: 0.2rem;
  }

  .set-creation-card {
    max-width: 540px;
  }

  .user-welcome-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 1rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid #E7D6DC;
  }

  .badge-user {
    font-size: 0.88rem;
    color: #8C1D40;
  }

  .set-select-section h2,
  .set-creation-form h2 {
    font-size: 1.6rem;
    color: #8C1D40;
    margin: 0 0 0.4rem 0;
  }

  .section-desc {
    font-size: 0.9rem;
    color: #5C4A52;
    margin: 0 0 1.5rem 0;
  }

  .wedding-sets-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .wedding-set-item {
    background: #FFF8F3;
    border: 1px solid #E7D6DC;
    padding: 1rem 1.25rem;
    border-radius: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .wedding-set-item:hover {
    border-color: #C44569;
    background: #FFF0F4;
    transform: translateY(-1px);
  }

  .set-title-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .set-title {
    font-size: 1.05rem;
    color: #2F1822;
  }

  .btn-enter-set {
    font-size: 0.82rem;
    font-weight: 700;
    color: #8C1D40;
  }

  .or-divider {
    text-align: center;
    position: relative;
    margin: 1.25rem 0;
  }

  .or-divider::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
    background: #E7D6DC;
    z-index: 1;
  }

  .or-divider span {
    position: relative;
    z-index: 2;
    background: #FFFDFB;
    padding: 0 0.8rem;
    font-size: 0.8rem;
    color: #9C858F;
    text-transform: uppercase;
  }

  .tenant-banner {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 12px;
    padding: 0.75rem 1.25rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    box-shadow: 0 2px 8px rgba(47, 24, 34, 0.03);
    flex-wrap: wrap;
  }

  .tenant-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .wedding-badge {
    font-size: 0.98rem;
    color: #8C1D40;
  }

  .tenant-tag {
    font-size: 0.72rem;
    background: #E6F4EA;
    color: #1E7E34;
    border: 1px solid #CEEAD6;
    padding: 0.15rem 0.55rem;
    border-radius: 12px;
    font-weight: 600;
  }

  .user-logged-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .user-email {
    font-size: 0.85rem;
    color: #5C4A52;
  }

  .btn-sm {
    padding: 0.4rem 0.8rem;
    font-size: 0.8rem;
  }

  .btn-logout {
    background: #FCE8E6;
    color: #C5221F;
    border: 1px solid #F87171;
    padding: 0.35rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .auth-error-alert {
    background: #FCE8E6;
    color: #C5221F;
    border: 1px solid #F87171;
    padding: 0.6rem 1rem;
    border-radius: 8px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .header-ornament {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }

  .gold-line {
    height: 1px;
    width: 60px;
    background: linear-gradient(90deg, transparent, #C89B3C, transparent);
  }

  .diamond {
    color: #C89B3C;
    font-size: 0.7rem;
  }

  .header-section {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }

  .header-actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .active-group-btn {
    background: #FFF0F4 !important;
    border-color: #8C1D40 !important;
    color: #8C1D40 !important;
  }

  .title-group h1 {
    font-size: 2.5rem;
    font-weight: 600;
    color: #8C1D40;
    margin: 0 0 0.4rem 0;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: #5C4A52;
    font-size: 0.98rem;
    margin: 0;
    max-width: 580px;
    line-height: 1.5;
  }

  .btn-primary {
    background-color: #8C1D40;
    color: #FFFDFB;
    border: 1px solid #8C1D40;
    padding: 0.75rem 1.4rem;
    border-radius: 10px;
    font-weight: 600;
    font-size: 0.92rem;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 14px rgba(140, 29, 64, 0.18);
  }

  .btn-primary:hover {
    background-color: #721633;
    border-color: #721633;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(140, 29, 64, 0.25);
  }

  .btn-secondary {
    background-color: transparent;
    color: #5C4A52;
    border: 1px solid #E7D6DC;
    padding: 0.65rem 1.1rem;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.88rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    transition: all 0.15s ease;
  }

  .btn-secondary:hover {
    background-color: #FFF8F3;
    color: #8C1D40;
    border-color: #C44569;
  }

  /* Status Badges */
  .status-badge {
    padding: 0.35rem 0.75rem;
    border-radius: 20px;
    font-size: 0.82rem;
    font-weight: 600;
    border: 1px solid transparent;
    outline: none;
    cursor: pointer;
    font-family: inherit;
  }

  .status-confirmado {
    background-color: #E6F4EA;
    color: #1E7E34;
    border-color: #CEEAD6;
  }

  .status-convite-entregue {
    background-color: #F3E8FF;
    color: #6B21A8;
    border-color: #E9D5FF;
  }

  .status-pendente {
    background-color: #FEF3D6;
    color: #B45309;
    border-color: #FDE68A;
  }

  .status-não-vai {
    background-color: #FCE8E6;
    color: #C5221F;
    border-color: #F87171;
  }

  /* Metric Cards */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .metric-card {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    padding: 1.2rem 1.4rem;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    box-shadow: 0 2px 8px rgba(47, 24, 34, 0.03);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }

  .metric-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(47, 24, 34, 0.06);
  }

  .metric-label {
    font-size: 0.82rem;
    color: #7A6670;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .metric-value {
    font-size: 1.8rem;
    font-weight: 700;
    color: #8C1D40;
    font-family: 'Playfair Display', Georgia, serif;
  }

  .metric-card.confirmados .metric-value {
    color: #1E7E34;
  }

  .metric-card.entregues .metric-value {
    color: #6B21A8;
  }

  .metric-card.pendentes .metric-value {
    color: #B45309;
  }

  .metric-card.ausentes .metric-value {
    color: #C5221F;
  }

  /* Drag and Drop Styles */
  .drag-handle-box {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
  }

  .drag-handle {
    cursor: grab;
    color: #A38F98;
    font-size: 0.95rem;
    user-select: none;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .row-dragging {
    opacity: 0.4;
    background-color: #FFF0F4 !important;
  }

  /* Tag Grouping Sections */
  .tag-grouped-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .tag-group-section {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 12px;
    overflow: hidden;
  }

  .tag-group-header {
    background: #FFF8F3;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid #E7D6DC;
  }

  .tag-group-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: #8C1D40;
  }

  /* CSV Modal Styles */
  .csv-modal-card {
    max-width: 680px;
  }

  .csv-modal-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    max-height: 80vh;
    overflow-y: auto;
  }

  .file-upload-box {
    border: 2px dashed #E7D6DC;
    border-radius: 14px;
    padding: 3rem 1.5rem;
    text-align: center;
    background: #FFF8F3;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .file-upload-box h3 {
    margin: 0;
    color: #8C1D40;
    font-size: 1.3rem;
  }

  .file-upload-box p {
    margin: 0;
    color: #7A6670;
    font-size: 0.9rem;
  }

  .file-input-label input[type="file"] {
    display: none;
  }

  .csv-step-header h3 {
    margin: 0 0 0.25rem 0;
    color: #8C1D40;
    font-size: 1.25rem;
  }

  .csv-step-header p {
    margin: 0;
    color: #5C4A52;
    font-size: 0.88rem;
  }

  .csv-columns-mapping-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 340px;
    overflow-y: auto;
    padding-right: 0.25rem;
  }

  .csv-col-mapping-card {
    background: #FFF8F3;
    border: 1px solid #E7D6DC;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }

  .col-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .col-name {
    font-size: 0.9rem;
    color: #2F1822;
  }

  .col-sample {
    font-size: 0.78rem;
    color: #7A6670;
    font-style: italic;
  }

  .col-role-select select {
    padding: 0.45rem 0.75rem;
    border: 1px solid #E7D6DC;
    border-radius: 8px;
    background: #FFFDFB;
    font-size: 0.85rem;
    color: #8C1D40;
    font-weight: 600;
    outline: none;
  }

  .csv-preview-table-container {
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid #E7D6DC;
    border-radius: 10px;
  }

  .preview-table th,
  .preview-table td {
    padding: 0.6rem 0.8rem;
    font-size: 0.82rem;
  }

  .preview-more-info {
    font-size: 0.8rem;
    color: #7A6670;
    text-align: center;
    margin: 0;
  }

  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .search-box {
    position: relative;
    flex: 1;
    min-width: 260px;
  }

  .search-icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: #9C858F;
    pointer-events: none;
  }

  .search-box input {
    width: 100%;
    padding: 0.75rem 2.6rem 0.75rem 2.6rem;
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 10px;
    font-size: 0.92rem;
    color: #2F1822;
    outline: none;
    transition: all 0.2s ease;
  }

  .search-box input:focus {
    border-color: #C44569;
    box-shadow: 0 0 0 3px rgba(196, 69, 105, 0.12);
  }

  .btn-clear {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #9C858F;
    cursor: pointer;
    font-size: 0.9rem;
  }

  .filter-pills {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .pill {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    color: #5C4A52;
    padding: 0.55rem 0.9rem;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .pill:hover {
    border-color: #C44569;
    color: #8C1D40;
  }

  .pill.active {
    background: #8C1D40;
    border-color: #8C1D40;
    color: #FFFDFB;
    font-weight: 600;
  }

  .tag-filter-strip {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 12px;
    padding: 0.85rem 1.1rem;
    margin-bottom: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    box-shadow: 0 2px 6px rgba(47, 24, 34, 0.02);
  }

  .tag-strip-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .tag-strip-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: #8C1D40;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .btn-reset-tags {
    background: none;
    border: none;
    color: #C44569;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }

  .tag-strip-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .tag-pill-btn {
    background: #FFF8F3;
    border: 1px solid #E7D6DC;
    color: #5C4A52;
    padding: 0.35rem 0.75rem;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tag-pill-btn:hover {
    border-color: #C44569;
    color: #8C1D40;
  }

  .tag-pill-btn.active {
    background: #8C1D40;
    border-color: #8C1D40;
    color: #FFFDFB;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(140, 29, 64, 0.2);
  }

  .counter-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #FFF8F3;
    border: 1px solid #E7D6DC;
    padding: 0.65rem 1rem;
    border-radius: 10px;
    margin-bottom: 1.25rem;
    font-size: 0.88rem;
    color: #5C4A52;
  }

  .counter-info {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .active-filters-tag {
    background: #FFF0F4;
    color: #8C1D40;
    border: 1px solid #F3CFD9;
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .btn-reset-filters {
    background: none;
    border: none;
    color: #C44569;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }

  .columns-dropdown-wrapper {
    position: relative;
  }

  .columns-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    width: 280px;
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(47, 24, 34, 0.12);
    padding: 1rem;
    z-index: 100;
  }

  .popover-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
    font-weight: 700;
    color: #8C1D40;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #F3E8EC;
  }

  .close-popover {
    background: none;
    border: none;
    color: #7A6670;
    cursor: pointer;
  }

  .popover-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 0.75rem;
  }

  .col-checkbox-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #4A3B42;
    cursor: pointer;
  }

  .col-checkbox-item input {
    accent-color: #8C1D40;
  }

  .btn-delete-col {
    margin-left: auto;
    background: none;
    border: none;
    cursor: pointer;
  }

  .add-column-form {
    display: flex;
    gap: 0.4rem;
    padding-top: 0.6rem;
    border-top: 1px solid #F3E8EC;
  }

  .add-column-form input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
    border: 1px solid #E7D6DC;
    border-radius: 6px;
  }

  .btn-add-col {
    background: #8C1D40;
    color: white;
    border: none;
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .table-container {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 14px;
    overflow-x: auto;
    box-shadow: 0 4px 20px rgba(47, 24, 34, 0.04);
  }

  .guest-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    min-width: 780px;
  }

  .guest-table th {
    background: #FFF8F3;
    color: #7A6670;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #E7D6DC;
  }

  .col-num-header,
  .col-num {
    width: 58px;
    text-align: center !important;
  }

  .row-number {
    font-size: 0.82rem;
    font-weight: 700;
    color: #9C858F;
    background: #FFF8F3;
    border: 1px solid #E7D6DC;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .guest-table td {
    padding: 1.1rem 1.25rem;
    border-bottom: 1px solid #F3E8EC;
    vertical-align: middle;
    color: #2F1822;
    font-size: 0.92rem;
  }

  .row-acompanhante td {
    background-color: #FFFDF9;
  }

  .name-info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }

  .guest-name {
    font-weight: 600;
    color: #2F1822;
    font-size: 0.92rem;
    word-break: break-word;
    overflow-wrap: anywhere;
    line-height: 1.3;
  }

  .subtag-badge {
    font-size: 0.7rem;
    color: #C44569;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .contact-box {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .phone {
    font-weight: 500;
    color: #4A3B42;
  }

  .email {
    font-size: 0.8rem;
    color: #8C7B83;
  }

  .tags-wrapper {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .tag-pill {
    background: #FFF0F4;
    color: #8C1D40;
    border: 1px solid #F3CFD9;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .companion-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    font-size: 0.82rem;
    font-weight: 500;
  }

  .companion-badge.secondary {
    background: #FFF0F4;
    border: 1px dashed #F3CFD9;
    color: #8C1D40;
  }

  .custom-cell-input {
    width: 100%;
    min-width: 120px;
    padding: 0.4rem 0.6rem;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    font-size: 0.88rem;
    color: #2F1822;
  }

  .custom-cell-input:hover,
  .custom-cell-input:focus {
    background: #FFFDFB;
    border-color: #E7D6DC;
    outline: none;
  }

  .actions-group {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .action-btn {
    background: transparent;
    border: 1px solid transparent;
    padding: 0.45rem;
    border-radius: 8px;
    color: #7A6670;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .edit-btn:hover {
    background-color: #FFF0F4;
    color: #8C1D40;
    border-color: #F3CFD9;
  }

  .delete-btn:hover {
    background-color: #FCE8E6;
    color: #C5221F;
    border-color: #F87171;
  }

  .text-right {
    text-align: right;
  }

  .empty-state {
    padding: 4rem 2rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .empty-state h3 {
    margin: 0;
    color: #8C1D40;
    font-size: 1.3rem;
  }

  .empty-state p {
    color: #7A6670;
    margin: 0 0 1rem 0;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(47, 24, 34, 0.45);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    z-index: 1000;
  }

  .modal-card {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 16px;
    width: 100%;
    max-width: 560px;
    box-shadow: 0 12px 32px rgba(47, 24, 34, 0.2);
    overflow: hidden;
    animation: modalSlide 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modalSlide {
    from { opacity: 0; transform: translateY(12px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid #E7D6DC;
    background: #FFF8F3;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.4rem;
    color: #8C1D40;
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.2rem;
    color: #7A6670;
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
  }

  .modal-close:hover {
    color: #8C1D40;
    background: #E7D6DC;
  }

  .modal-form {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    max-height: 80vh;
    overflow-y: auto;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 1;
  }

  .form-group label,
  .label-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #4A3B42;
  }

  .form-group input,
  .form-group select {
    padding: 0.7rem 0.9rem;
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 8px;
    font-size: 0.92rem;
    color: #2F1822;
    outline: none;
    font-family: inherit;
  }

  .form-group input:focus,
  .form-group select:focus {
    border-color: #C44569;
    box-shadow: 0 0 0 3px rgba(196, 69, 105, 0.12);
  }

  .form-row {
    display: flex;
    gap: 1rem;
  }

  .companion-config-box {
    background: #FFF8F3;
    padding: 1rem;
    border: 1px solid #E7D6DC;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.9rem;
    font-weight: 600;
    color: #8C1D40;
    cursor: pointer;
  }

  .checkbox-label input {
    accent-color: #8C1D40;
    width: 18px;
    height: 18px;
  }

  .select-principal-box {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }

  .tag-selector-box {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.6rem;
    background: #FFF8F3;
    border: 1px solid #E7D6DC;
    border-radius: 8px;
  }

  .tag-toggle-btn {
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    color: #5C4A52;
    padding: 0.35rem 0.75rem;
    border-radius: 20px;
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
  }

  .tag-toggle-btn.selected {
    background: #8C1D40;
    color: white;
    border-color: #8C1D40;
  }

  .add-tag-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }

  .add-tag-row input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
  }

  .tag-manager-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .tag-manager-help {
    font-size: 0.85rem;
    color: #7A6670;
    margin: 0;
    line-height: 1.4;
  }

  .tag-manage-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid #E7D6DC;
    border-radius: 10px;
    padding: 0.8rem;
    background: #FFF8F3;
  }

  .tag-manage-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    background: #FFFDFB;
    border: 1px solid #E7D6DC;
    border-radius: 8px;
  }

  .tag-manage-actions {
    display: flex;
    gap: 0.3rem;
  }

  .btn-icon-tag {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .btn-icon-tag:hover {
    background: #F3E8EC;
  }

  .tag-edit-input {
    flex: 1;
    padding: 0.3rem 0.5rem;
    font-size: 0.85rem;
    border: 1px solid #C44569;
    border-radius: 6px;
  }

  .btn-save-tag {
    background: #1E7E34;
    color: white;
    border: none;
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-cancel-tag {
    background: #7A6670;
    color: white;
    border: none;
    padding: 0.3rem 0.6rem;
    border-radius: 6px;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .add-tag-manager-form {
    display: flex;
    gap: 0.5rem;
  }

  .add-tag-manager-form input {
    flex: 1;
    padding: 0.6rem 0.8rem;
    border: 1px solid #E7D6DC;
    border-radius: 8px;
    font-size: 0.88rem;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid #F3E8EC;
  }

  @media (max-width: 768px) {
    .header-section {
      flex-direction: column;
      align-items: flex-start;
    }

    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }

    .toolbar-right {
      flex-direction: column;
      align-items: stretch;
    }

    .form-row {
      flex-direction: column;
    }

    .counter-bar {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }

    .tenant-banner {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  @media (max-width: 600px) {
    .title-group h1 {
      font-size: 1.8rem;
    }

    .guest-table {
      min-width: 100%;
    }

    .guest-table th,
    .guest-table td {
      padding: 0.75rem 0.5rem;
    }

    .col-num-header,
    .col-num {
      width: 32px;
      padding-left: 0.25rem !important;
      padding-right: 0.25rem !important;
    }

    .row-number {
      width: 22px;
      height: 22px;
      font-size: 0.75rem;
    }

    .guest-name {
      font-size: 0.88rem;
    }

    .filter-pills {
      justify-content: flex-start;
    }

    .pill {
      font-size: 0.78rem;
      padding: 0.45rem 0.75rem;
    }
  }
</style>
