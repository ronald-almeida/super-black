# Super Black Bússola — ofertas e checkout Pix

Página de ofertas baseada na referência fornecida, seguida de checkout com Pix via Black Cat. Valores **totais à vista**, na ordem pedida:

| Condição | Valor |
| --- | --- |
| Não sou aluno | R$ 347,00 |
| Aluno ou ex-aluno | R$ 297,00 |
| Club, Elite ou Black 2025 | R$ 247,00 |

O preço anterior de R$ 35.101 foi mantido da referência; desconto e economia são recalculados. Não há parcelamento com cartão nesta implementação. O rodapé identifica Black Cat, a operadora utilizada, e não a Hotmart. Fontes Hotmart Sans e Hotmart Display são carregadas do CDN público oficial da Hotmart, com os fallbacks solicitados.

## Executar

Requer Node.js 22.9+ (recomendado Node.js 24 LTS). Sem dependências para instalar.

1. Copie `.env.example` para `.env`.
2. Configure `BLACKCAT_API_KEY` com sua chave do painel Black Cat **somente no servidor**.
3. Execute `npm start` ou `node --env-file-if-exists=.env server.mjs`.
4. Abra `http://localhost:3000`.

Sem a chave, as páginas continuam disponíveis, mas a geração de Pix retorna indisponibilidade. Nenhuma cobrança fictícia é criada no modo normal. Não inclua a chave em JavaScript público, no GitHub ou em variáveis com prefixo `NEXT_PUBLIC_`/`VITE_`.

## Publicar

O repositório tem `vercel.json` e funções Node em `api/`. Na Vercel, importe este repositório, selecione preset **Other**, diretório de saída **public**, sem comando de build, e configure `BLACKCAT_API_KEY` nas variáveis de ambiente antes do deploy. Não é necessário banco de dados. A hospedagem precisa executar funções Node; GitHub Pages sozinho não executa a integração.

Em uma hospedagem Node tradicional, execute `npm start` com `HOST=0.0.0.0`, `PORT` definido pela plataforma e a chave em variável de ambiente. Use HTTPS no domínio público para permitir a cópia automática do código Pix.

## Fluxo e privacidade

- `/` apresenta as três ofertas; `/checkout?oferta=nao-aluno`, `aluno` ou `club` abre a condição correta.
- O navegador envia nome, email, confirmação de email, CPF/CNPJ e celular para `POST /api/pix`.
- O servidor valida os dados, escolhe o valor a partir da lista de ofertas e chama `POST https://api.blackcatoficial.com/api/sales/create-sale`. Valores enviados pelo navegador são ignorados.
- O pop-up apresenta o QR code retornado pela operadora, o Pix Copia e Cola e a validade. Se a operadora não retornar imagem, o código copia e cola continua disponível.
- A confirmação consulta `GET /api/status` e o endpoint de status da Black Cat a cada oito segundos enquanto o pop-up estiver aberto. Um token assinado limita a consulta à cobrança criada.
- Não há banco, cookies de pagamento, localStorage ou gravação em arquivos. O Pix fica apenas na memória da página; atualizar/fechar a página perde essa referência. A operadora mantém o registro da transação no próprio serviço.
- Botão bloqueado durante a criação e reabertura do mesmo Pix na página evitam cliques repetidos. Como não há armazenamento nem idempotência documentada na API, recarregar a página ou repetir após falha de rede pode criar outra cobrança; não há promessa de deduplicação entre sessões.
- Não há liberação automática de curso, envio de email ou webhook. O pagamento confirmado é exibido na tela e fica disponível no painel Black Cat.
- Não são registradas chaves nem dados pessoais no console do servidor. Configure também a hospedagem para não registrar corpos de requisição nem query strings de `/api/status`.

Documentação utilizada: https://docs.blackcatoficial.com/

## Testes

Execute `npm test` ou `node --test`. Os testes usam respostas simuladas exclusivamente em teste e cobrem os três preços, validação de documentos, adulteração de valor, assinatura da consulta, falhas da operadora e ausência de chave. Não geram transações reais.

Antes de disponibilizar vendas, configure a chave e valide uma cobrança controlada no seu ambiente Black Cat. A integração real não pode ser validada sem essa credencial.
