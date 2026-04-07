import { client } from './client';
import type { ExchangeAccount } from '../store/accounts';

// 백엔드 요청/응답 타입 (snake_case → camelCase 변환)
interface ExchangeAccountDTO {
  id:         string;
  name:       string;
  exchange:   string;
  api_key:    string;
  api_secret: string;
  agent_id:   string | null;
  is_active:  boolean;
  created_at: string;
}

function fromDTO(dto: ExchangeAccountDTO): ExchangeAccount {
  return {
    id:        dto.id,
    name:      dto.name,
    exchange:  dto.exchange as ExchangeAccount['exchange'],
    apiKey:    dto.api_key,
    apiSecret: dto.api_secret,
    agentId:   dto.agent_id,
    isActive:  dto.is_active,
    createdAt: dto.created_at,
  };
}

export const exchangeAccountsService = {
  list: async (): Promise<ExchangeAccount[]> => {
    const dtos = await client.get<ExchangeAccountDTO[]>('/exchange-accounts/');
    return dtos.map(fromDTO);
  },

  create: async (input: Omit<ExchangeAccount, 'id' | 'createdAt'>): Promise<ExchangeAccount> => {
    const dto = await client.post<ExchangeAccountDTO>('/exchange-accounts/', {
      name:       input.name,
      exchange:   input.exchange,
      api_key:    input.apiKey,
      api_secret: input.apiSecret,
      agent_id:   input.agentId,
      is_active:  input.isActive,
    });
    return fromDTO(dto);
  },

  update: async (id: string, updates: Partial<Omit<ExchangeAccount, 'id' | 'createdAt'>>): Promise<ExchangeAccount> => {
    const body: Record<string, unknown> = {};
    if (updates.name      !== undefined) body.name       = updates.name;
    if (updates.exchange  !== undefined) body.exchange   = updates.exchange;
    if (updates.apiKey    !== undefined) body.api_key    = updates.apiKey;
    if (updates.apiSecret !== undefined) body.api_secret = updates.apiSecret;
    if (updates.agentId   !== undefined) body.agent_id   = updates.agentId;
    if (updates.isActive  !== undefined) body.is_active  = updates.isActive;
    const dto = await client.patch<ExchangeAccountDTO>(`/exchange-accounts/${id}/`, body);
    return fromDTO(dto);
  },

  remove: async (id: string): Promise<void> => {
    await client.delete(`/exchange-accounts/${id}/`);
  },
};
