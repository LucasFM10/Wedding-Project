import { pb } from './pocketbase';

export interface CasamentoRecord {
  id: string;
  titulo: string;
  data_evento?: string;
  dono: string;
  membros?: string[];
}

export interface ConvidadoPB {
  id: string;
  casamento: string;
  nome: string;
  contato: string;
  email: string;
  confirmacao: 'Confirmado' | 'Pendente' | 'Não vai';
  tags: string[];
  is_acompanhante: boolean;
  convidado_principal?: string;
  custom_fields?: Record<string, string>;
}

class CasamentoState {
  casamentoAtivo = $state<CasamentoRecord | null>(null);
  casamentosDoUsuario = $state<CasamentoRecord[]>([]);
  loading = $state(false);
  errorMsg = $state('');

  async carregarCasamentosDoUsuario(userId: string) {
    try {
      this.loading = true;
      this.errorMsg = '';

      // O listRule da coleção 'casamentos' no PocketBase já filtra automaticamente
      // apenas os casamentos onde o usuário logado seja dono ou membro
      const result = await pb.collection('casamentos').getList<CasamentoRecord>(1, 50);

      this.casamentosDoUsuario = result.items;

      if (result.items.length > 0) {
        // Seleciona o primeiro casamento como ativo por padrão
        this.casamentoAtivo = result.items[0];
      } else {
        this.casamentoAtivo = null;
      }
    } catch (err: any) {
      console.error('Erro ao carregar casamentos:', err);
      this.errorMsg = err.message || 'Erro ao consultar casamentos do usuário.';
      this.casamentoAtivo = null;
      this.casamentosDoUsuario = [];
    } finally {
      this.loading = false;
    }
  }

  async criarNovoCasamento(userId: string, titulo: string, dataEvento?: string): Promise<CasamentoRecord> {
    try {
      this.loading = true;
      this.errorMsg = '';

      const novo = await pb.collection('casamentos').create<CasamentoRecord>({
        titulo: titulo.trim(),
        data_evento: dataEvento || null,
        dono: userId
      });

      this.casamentosDoUsuario = [novo, ...this.casamentosDoUsuario];
      this.casamentoAtivo = novo;
      return novo;
    } catch (err: any) {
      this.errorMsg = err.message || 'Erro ao criar o conjunto de casamento.';
      throw err;
    } finally {
      this.loading = false;
    }
  }

  selecionarCasamento(casamento: CasamentoRecord) {
    this.casamentoAtivo = casamento;
  }

  limpar() {
    this.casamentoAtivo = null;
    this.casamentosDoUsuario = [];
    this.errorMsg = '';
  }
}

export const casamentoState = new CasamentoState();
