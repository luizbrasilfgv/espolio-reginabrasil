# Firebase Spark e operação

## Pré-requisitos

- Confirme no console que o projeto está em **Spark**, sem conta de faturamento. A aplicação usa um site de Firebase Hosting e a base Firestore Standard padrão.
- Em Authentication, habilite Google e autorize o domínio do site novo. O `authDomain` da compilação de produção é o próprio `*.web.app`, para suportar redirect em navegadores que bloqueiam cookies de terceiros.
- Em Google Auth Platform → Clientes, adicione a URI de retorno https://espolio-reginabrasil.web.app/__/auth/handler ao cliente OAuth Web do Google e preserve as URIs já cadastradas.
- Registre o Web App, copie os campos públicos de `.env.example` para `.env.production.local` e use `npm ci`.
- O proprietário da conta administrativa precisa já existir no Firebase Auth com provedor Google e e-mail verificado.

## Publicação no Atlas

Execute os comandos da raiz deste projeto. Os exemplos usam a CLI autenticada localmente. Use a configuração gerada para preservar as Rules dos outros caminhos e implantar no site separado.

```sh
npx firebase login
npx firebase target:apply hosting espolio espolio-reginabrasil --project atlas-reginabrasil
node scripts/production.mjs auth-domain --project atlas-reginabrasil --site espolio-reginabrasil --firebase-cli --apply
node scripts/production.mjs prepare --project atlas-reginabrasil --site espolio-reginabrasil --firebase-cli
npm test
npm run test:rules
npm run build
node scripts/verify-google-redirect.mjs atlas-reginabrasil espolio-reginabrasil
node scripts/production.mjs verify-rules --project atlas-reginabrasil --site espolio-reginabrasil --firebase-cli
npx firebase deploy --only firestore:rules --config firebase.production.local.json --project atlas-reginabrasil
```

Confira `firebase firestore:indexes --project atlas-reginabrasil --json` antes de publicar índices. Integre os índices existentes a uma cópia local antes de publicar o novo índice de `reginaEvents`. Na primeira publicação, a consulta encontrou zero índices compostos e zero isenções existentes. Em publicações futuras, se o bloco do espólio já existir, preserve as outras regras e substitua apenas o bloco após revisão. A cópia de segurança fica em `.firebase/atlas-original.rules`.

```sh
npx firebase deploy --only firestore:indexes --config firebase.production.local.json --project atlas-reginabrasil
npm run seed -- --project atlas-reginabrasil --admin-email EMAIL_GOOGLE --firebase-cli
npm run seed -- --project atlas-reginabrasil --admin-email EMAIL_GOOGLE --firebase-cli --apply
npx firebase deploy --only hosting:espolio --config firebase.production.local.json --project atlas-reginabrasil
```

O seed lista IDs faltantes e nomes dos campos divergentes. A aplicação acrescenta somente IDs faltantes e preserva versões posteriores. Repita a simulação após a gravação e confira que a lista de IDs faltantes está vazia.

Para um projeto exclusivo e vazio, `firebase.json` contém as Rules isoladas e pode ser usado diretamente com um projeto explicitamente selecionado. No Atlas, use o arquivo preparado e um destino de Hosting específico.

## App Check e cotas

O build de produção começa com `VITE_AI_SPARK_VERIFIED=false`. Antes de considerar a ativação, confirme no console que o projeto continua Spark, que o modelo selecionado no Gemini Developer API tem uso gratuito, e que reCAPTCHA Enterprise e App Check estão configurados para o domínio e em modo de aplicação no Firebase AI Logic. Verifique as políticas de retenção de conteúdo com a família. Configure `VITE_AI_MODEL`, `VITE_APPCHECK_SITE_KEY` e a flag de verificação, valide em testes com dados fictícios e só depois habilite `aiEnabled` na administração.

Em caso de mudança de cotas, problema de privacidade ou erro de App Check, desative `aiEnabled` e revise o uso no console. No limite do Spark, aguarde a renovação da cota. Monitore Hosting e Firestore no console, incluindo as cotas compartilhadas com o Atlas.

## Recuperação

- Controle de acesso: use o console autenticado do proprietário para recuperar o UID de administração. Confira identidade Google verificada e a coleção `estates/regina/members`.
- Dados: audite os eventos antes de corrigir um registro. Faça correções pelo editor para preservar a trilha. Rode o seed em simulação para verificar IDs iniciais faltantes.
- Regras: use a cópia original para comparar e recuperar as regras de outros caminhos. Preserve o bloco do espólio ou suspenda seu acesso ao restaurar. Revise as regras no emulador antes de publicar.
- Hosting: o console permite reverter uma versão no site `espolio-reginabrasil`. O site padrão do Atlas tem histórico independente.

[Planos Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) · [Firebase Hosting multisite](https://firebase.google.com/docs/hosting/multisites) · [App Check para AI Logic](https://firebase.google.com/docs/ai-logic/app-check) · [Cotas Firestore](https://firebase.google.com/docs/firestore/pricing)
