# Espólio Regina Brasil

PWA familiar em HTML, CSS e JavaScript vanilla. A implantação usa Firebase Hosting, Firebase Authentication com Google e o Firestore Standard do projeto Spark. O navegador carrega a interface estática e verifica a autorização do UID antes de buscar as pendências.

- Produção · [espolio-reginabrasil.web.app](https://espolio-reginabrasil.web.app)
- Design editável · [UI Kit & PWA no Canva](https://canva.link/jyer30p35yhmrbb)
- [Guia da família](docs/USER_GUIDE.md)
- [Operação, deploy e recuperação](docs/DEPLOY.md)
- [Decisões de implementação](docs/DECISIONS.md)

## Executar e verificar

Use Node.js 22.12+ e Java 21 para os emuladores.

```sh
npm ci
npm test
npm run test:rules
npm run test:browser
npm run build
```

O teste de navegador usa Edge ou Chrome local. Defina `BROWSER_PATH` se o navegador estiver fora do caminho padrão. Para desenvolvimento com a configuração pública de um Firebase autorizado, copie `.env.example` para `.env.local`, preencha os campos públicos e execute `npm run dev`. Para os emuladores, use `npm run build:emulator` e `npx firebase emulators:start --only auth,firestore,hosting --config firebase.emulator.json --project demo-espolio-regina`.

`dist/` é a única pasta publicada no Firebase. O catálogo privado em `data/initial-tasks.json` fica fora do Git e do Firebase Hosting. Os testes e emuladores usam o catálogo fictício em `tests/fixtures/tasks.json`. Para publicar no Atlas, siga a preparação das regras compartilhadas em `docs/DEPLOY.md`.

A interpretação remota começa desativada. Ditado compatível, consulta e edição manual funcionam independentemente do Gemini.
