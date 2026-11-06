# Decisões de implementação

- **URL separada.** O site `espolio-reginabrasil` usa um Web App dedicado dentro de `atlas-reginabrasil`. Hosting, Auth e Firestore pertencem ao mesmo projeto Spark.
- **Isolamento.** Os dados usam `estates/regina` no Firestore padrão. Os documentos de membros e autorizações do Atlas e do espólio são independentes. O cadastro do Google Auth é compartilhado no projeto.
- **Auditoria.** Os eventos ficam em `estates/regina/reginaEvents`, consultáveis por tarefa ou horário. Essa coleção dedicada permite consultar a atividade sem regras de consulta global que alcancem outras coleções do Atlas. As Rules confrontam o antes/depois integral com a mudança atômica. A interface calcula as diferenças desses snapshots.
- **Responsáveis.** O diretório compartilhado guarda apenas os nomes de exibição. O documento de membro completo fica acessível ao titular e ao administrador. Os rótulos históricos do seed não recebem UID por inferência.
- **Histórico.** Consultas usam paginação e o aplicativo não configura cache persistente do Firestore. O Service Worker armazena apenas arquivos da interface. A sessão Google usa a persistência padrão do navegador e sai pelo botão Sair.
- **IA.** Só pode ser habilitada após verificação de Spark, modelo gratuito, App Check e privacidade. A confirmação é uma garantia do fluxo da interface. As regras verificam autoria, integridade e papel, enquanto a autorização de origem para IA é separada.
- **Relatórios.** JSON e CSV são snapshots operacionais com referências internas omitidas. O WhatsApp usa rótulos, contagens e IDs, sem texto livre. Esses arquivos servem para acompanhamento. Uma recuperação integral requer acesso administrativo ao banco.
- **Permissões administrativas.** O proprietário do projeto pode operar fora das Rules. Mudanças administrativas externas devem seguir o procedimento documentado. A lista de sete assuntos tem chaves estáveis do PRD.
