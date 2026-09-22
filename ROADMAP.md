# Roadmap — Campaign Mailer

Plan d'exécution de A à Z, du repo vide jusqu'au lancement public.
Référence : `Cahier des Charges — Campaign Mailer v1.0`.

- **Statut** : Phases 0 à 6 terminées (Phase 6 validée par le propriétaire le 15 septembre 2026). Phase 7 livrée le 15 septembre 2026, en attente de revue ; deux critères de sa Definition of Done (la CI exécute les tests, le parcours end-to-end passe en CI) restent invérifiables tant que GitHub Actions est désactivé sur le compte, et la remontée d'une erreur dans Sentry attend le DSN du projet. Phase 4 validée par le propriétaire le 14 septembre 2026, après le test réel (#67 : 5 emails sur 5 acceptés par Gmail, espacés de 11 s, aucun doublon). Reste ouvert en Phase 0 : les deux clés Cloudflare R2 et la demande de vérification Google.
- **22 septembre 2026, hors phase** : envoi à la seconde près (le planificateur tournait toutes les 15 minutes, un envoi prévu à 10:00 partait à 10:13), compte à rebours en temps réel du prochain envoi, rythme journalier masqué quand la campagne tient en une journée, nouvel aperçu du message. En Phase 9, ajout de la vérification des destinataires et de l'intégration avec MailFind. Page Contacts livrée le même jour : tous les contacts du compte, CRUD, tri, recherche et pagination, colonne `source` (`csv`, `manual`, `mailfind`) prête pour l'intégration.
- **Dernière mise à jour** : 22 septembre 2026
- **Cadence de révision** : fin de chaque phase

---

## 0. Comment lire ce document

Chaque phase contient :

- **Objectif** : ce qui doit être vrai à la fin de la phase.
- **Lots de travail** : tickets à créer dans le tracker (1 puce = 1 ticket = 1 commit + push).
- **Definition of Done** : critères vérifiables. Une phase n'est pas terminée si un seul critère manque.
- **Risques** : ce qui peut faire déraper la phase, et la parade.

Chaque lot de travail porte une annotation `→ skills :` listant les skills à charger **avant** d'écrire le code de ce lot.

### Rituel appliqué à chaque tâche

Cet enchaînement est le même pour tous les lots de travail, il n'est donc pas répété dans les annotations :

1. `brainstorming` — obligatoire avant toute création de fonctionnalité ou de composant.
2. Skills métier du lot (colonne `→ skills :`).
3. `test-driven-development` — test avant code, quand le lot est testable.
4. Implémentation. `surgical-patch` pour une édition ciblée, `safe-refactor` si le lot touche du code existant.
5. `code-review` (natif) puis `caveman-review` sur le diff.
6. `verification-before-completion` — avant de déclarer le lot terminé.
7. `caveman-commit` — message de commit, puis `git push`.

En cas de bug pendant un lot : `investigate-first`, puis `systematic-debugging`, puis `verify-and-stop`.

### Conventions git

- `main` protégée. Une branche par ticket : `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Conventional Commits, rédigés avec `caveman-commit`.
- **Commit + push après chaque tâche terminée.** Pas de tâche en cours non poussée en fin de session.
- Fin de branche : `finishing-a-development-branch`.
- Deux lots indépendants menés en parallèle : `using-git-worktrees` + `dispatching-parallel-agents`.

### Skills transverses, actifs en permanence

| Skill                               | Quand                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `caveman`                           | Tout le temps. Compression des échanges, jamais du code ni des docs.            |
| `writing-plans` / `executing-plans` | Découpage d'un lot en plusieurs étapes, puis exécution.                         |
| `verification-before-completion`    | Fin de chaque lot.                                                              |
| `caveman-commit`                    | Chaque commit.                                                                  |
| `lean-build`                        | Dès qu'un lot commence à grossir au-delà de son périmètre.                      |
| `cavecrew`                          | Délégation d'investigation, d'édition ou de revue à des sous-agents compressés. |

### Skills cités dans la configuration mais non installés

Le mapping global mentionne `pick-ui-library`, `prototype` et `review-animations`. Ces trois skills ne figurent pas dans les skills disponibles de l'environnement. Cette roadmap ne s'appuie donc pas sur eux. Substituts retenus : `frontend-design` et `composition-patterns` pour le choix de bibliothèque UI, `motion-design` pour la critique d'animation.

---

## Vue d'ensemble

| Phase | Contenu                                  | Durée cible | Livrable                                    |
| ----- | ---------------------------------------- | ----------- | ------------------------------------------- |
| 0     | Fondations projet & décisions techniques | 2–3 j       | Repo initialisé, décisions gelées, CI verte |
| 1     | Auth Google OAuth + socle app            | 5 j         | Login/logout fonctionnel, dashboard vide    |
| 2     | CRUD campagnes + éditeur de template     | 5 j         | Créer/éditer une campagne, preview          |
| 3     | Contacts CSV + pièces jointes            | 4 j         | Import 200+ contacts, upload CV             |
| 4     | Moteur d'envoi (queue + Gmail API)       | 6 j         | Campagne réellement envoyée, statuts à jour |
| 5     | Dashboard, stats, gestion contacts       | 4 j         | Suivi d'avancement complet                  |
| 6     | Durcissement : sécurité, RGPD, quotas    | 4 j         | Chiffrement tokens, purge, rate limit       |
| 7     | Tests, observabilité, documentation      | 4 j         | Couverture cible, logs, runbook             |
| 8     | Déploiement production & alpha test      | 3 j         | URL publique, 5–10 bêta-testeurs            |
| 9     | Post-MVP (phase 2 du CDC)                | itératif    | Templates, tracking, séquences, A/B         |

Total MVP (phases 0–8) : **~37 jours ouvrés**, soit ~130 h à 1–2 devs. Aligné sur l'estimation du CDC.

---

## Phase 0 — Fondations et décisions gelées

**Objectif** : plus aucune décision d'architecture bloquante ne reste ouverte, et un squelette de code compile et déploie.

### Décisions à trancher avant d'écrire du code

→ skills : `brainstorming`, `writing-plans`

Le CDC laisse plusieurs alternatives ouvertes. Elles doivent être fermées ici, car elles changent le code de toutes les phases suivantes.

| Sujet                              | Options CDC                         | Recommandation                                     | Raison                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base de données                    | PostgreSQL ou Firestore             | **PostgreSQL**                                     | Le modèle du CDC est relationnel (FK, ENUM, agrégats de stats). Firestore obligerait à dénormaliser.                                                                                                                                                                                                                |
| Envoi email                        | Gmail API OAuth2 ou SMTP Nodemailer | **Gmail API (REST) via OAuth2**                    | Sur Railway/Vercel, le SMTP sortant est souvent bloqué ou limité. L'API REST utilise le même token que le login.                                                                                                                                                                                                    |
| Stockage pièces jointes            | Google Drive ou stockage objet      | **Stockage objet S3-compatible (Cloudflare R2)**   | Drive impose un scope OAuth supplémentaire intrusif et une latence de lecture à chaque envoi. Le CV doit être lu des dizaines de fois par jour. R2 : 10 Go gratuits, aucun frais d'egress.                                                                                                                          |
| Queue                              | Bull + Redis ou cron                | **BullMQ + Redis (Upstash)**                       | Retry, backoff et jobs différés nécessaires pour respecter la cadence et les quotas.                                                                                                                                                                                                                                |
| Postgres et Redis en développement | Docker local ou services hébergés   | **Hébergés dès le développement (Neon + Upstash)** | Docker n'est pas installé sur la machine du porteur. Les mêmes services en dev et en prod suppriment une classe d'écarts d'environnement. Contrepartie : des identifiants réels dans `backend/.env` dès la Phase 0.                                                                                                 |
| Fournisseur Postgres               | Supabase, Neon, Railway             | **Neon**                                           | Supabase limite le tier gratuit à 2 projets actifs par owner, quota déjà atteint. Neon : PostgreSQL 17 réel, gratuit sans carte, jusqu'à 20 projets. Réserve : le scale-to-zero rend le dev gratuit, mais une API 24/7 dépasserait les 100 CU-heures mensuelles — l'hébergement production se retranche en Phase 8. |
| Langage backend                    | JS ou TS                            | **TypeScript**                                     | Le modèle de données a beaucoup d'états (`status`, `event_type`). Le typage évite des bugs d'état silencieux.                                                                                                                                                                                                       |
| Hébergement backend                | Railway ou Render                   | **Railway**                                        | Postgres + Redis + service Node dans un seul projet.                                                                                                                                                                                                                                                                |

Deux écarts au CDC sont volontaires (stockage objet au lieu de Drive, TypeScript au lieu de JS). À valider par le porteur du projet avant la Phase 1 ; sinon, adapter les phases 3 et 4.

### Lots de travail

- Configurer l'identité git du repo (`user.name`, `user.email`), vérifier l'accès en push sur `origin`.
  → skills : aucun
- Initialiser le monorepo : `frontend/`, `backend/`, `README.md`, `CONTRIBUTING.md`, `LICENSE`, `.gitignore`, `.editorconfig`.
  → skills : `lean-build`
- Générer le `CLAUDE.md` du projet (stack, commandes, conventions, pièges connus).
  → skills : `init`
- Scaffolder `frontend/` : React 19 + Vite + TypeScript + Tailwind CSS + React Router.
  → skills : `react-best-practices`, `lean-build`
- Scaffolder `backend/` : Express + TypeScript, structure `routes/`, `controllers/`, `services/`, `models/`, `middleware/`, `jobs/`.
  → skills : `lean-build`
- Mettre en place l'outillage qualité : ESLint, Prettier, `tsc --noEmit`, husky + lint-staged. Régler l'ExecutionPolicy PowerShell en `RemoteSigned` au préalable, sinon les hooks husky ne s'exécutent pas sur Windows.
  → skills : aucun
- Écrire `backend/.env.example` et `frontend/.env.example` complets (voir §9 du CDC).
  → skills : aucun
- Provisionner Postgres (Neon), Redis (Upstash) et le bucket de pièces jointes (Cloudflare R2) pour le développement, renseigner `backend/.env`, vérifier la connexion depuis le backend.
  → skills : aucun (action console, hors code)
- Mettre en place les migrations : `node-pg-migrate` (ou Prisma si l'équipe préfère un ORM typé).
  → skills : `migration`
- Écrire la migration initiale : tables `users`, `campaigns`, `contacts`, `logs` conformes au §5 du CDC, avec index sur `contacts(campaign_id, status)` et `logs(campaign_id, created_at)`.
  → skills : `migration`, `test-driven-development`
- Configurer la CI GitHub Actions : lint + typecheck + tests + build sur chaque PR.
  → skills : aucun
- Créer le projet Google Cloud : activer Gmail API, configurer l'écran de consentement OAuth, créer les identifiants client web, déclarer les URIs de redirection dev et prod, déposer la demande de vérification. Marche à suivre détaillée : `docs/google-oauth-setup.md`.
  → skills : aucun (action console, hors code)
- Réduire les frictions de permissions de l'agent sur les commandes récurrentes du projet (`npm`, `git`, `docker compose`).
  → skills : `fewer-permission-prompts`
- Créer les tickets de toutes les phases dans le tracker, avec labels par phase.
  → skills : `writing-plans`

### Definition of Done

→ skills : `verification-before-completion`

- `npm install && npm run dev` démarre front et back en local sans erreur.
- `docker compose up` fournit Postgres et Redis, et `npm run migrate:latest` passe.
- La CI est verte sur une PR de test.
- Les identifiants Google OAuth existent et sont documentés dans un gestionnaire de secrets.
- Le tableau de décisions ci-dessus est validé et daté.

### Risques

- **Validation OAuth Google** : le scope `gmail.send` est un scope sensible. En mode « Testing », il est limité à 100 utilisateurs mais utilisable immédiatement. La validation pour la production peut prendre plusieurs semaines. **Parade** : lancer la demande de vérification dès la Phase 0, en parallèle du développement, et rester en mode Testing pour l'alpha.

---

## Phase 1 — Authentification et socle applicatif

**Objectif** : un utilisateur se connecte avec Google, atterrit sur son dashboard, et le backend détient un refresh token utilisable pour envoyer des emails en son nom.

### Lots de travail

- Backend : configurer Passport.js + `passport-google-oauth20`, avec les scopes `openid`, `email`, `profile`, `https://www.googleapis.com/auth/gmail.send`.
  → skills : `brainstorming`, `test-driven-development`
- Backend : demander `access_type=offline` et `prompt=consent` pour obtenir un refresh token.
  → skills : `test-driven-development`
- Backend : implémenter `POST /api/auth/google/callback`, `GET /api/auth/logout`, `GET /api/auth/me`.
  → skills : `test-driven-development`, `code-review`
- Backend : sessions via cookies `httpOnly`, `secure`, `sameSite=lax`, stockées en Redis (`connect-redis`).
  → skills : `security-review`
- Backend : service de chiffrement AES-256-GCM pour `google_access_token` et `google_refresh_token` au repos.
  → skills : `test-driven-development`, `security-review`
- Backend : service de rafraîchissement de token, appelé avant tout usage de l'API Gmail.
  → skills : `test-driven-development`, `systematic-debugging` (si comportement de refresh instable)
- Backend : middleware `requireAuth` et middleware `requireCampaignOwner` (contrôle d'accès par ressource).
  → skills : `test-driven-development`, `security-review`
- Backend : `helmet`, `cors` restreint à `FRONTEND_URL`, `express-rate-limit` à 100 req/min par utilisateur.
  → skills : `security-review`
- Frontend : page Login, bouton « Continuer avec Google », gestion de l'état d'authentification, route guard.
  → skills : `frontend-design`, `taste-skill`, `signup`, `react-best-practices`, `composition-patterns`
- Frontend : layout applicatif (nav, header utilisateur, déconnexion) et page Dashboard vide.
  → skills : `frontend-design`, `theme-factory`, `composition-patterns`, `web-design-guidelines`
- Frontend : états de chargement et de transition du parcours OAuth (redirection, retour, échec).
  → skills : `motion-design`, `emil-design-eng`
- Tests : parcours login/logout, refus d'accès non authentifié, refus d'accès à la campagne d'autrui.
  → skills : `test-driven-development`, `verification-before-completion`
- Vérification manuelle du parcours dans l'application réelle.
  → skills : `run`

### Definition of Done

→ skills : `verification-before-completion`, `requesting-code-review`

- Un compte Google réel se connecte et se déconnecte de bout en bout.
- Le refresh token est présent en base et chiffré (vérifié par inspection SQL : la valeur n'est pas lisible).
- `GET /api/auth/me` renvoie 401 sans session.
- Un utilisateur A reçoit 403 ou 404 sur une ressource de l'utilisateur B.

### Risques

- **Refresh token absent** : Google ne renvoie le refresh token qu'à la première autorisation. **Parade** : forcer `prompt=consent`, et ne jamais écraser un refresh token existant par une valeur nulle.

---

## Phase 2 — CRUD campagnes et éditeur de template

**Objectif** : un utilisateur crée une campagne, écrit son message avec des variables, et voit un aperçu rendu.

### Lots de travail

- Backend : `GET/POST /api/campaigns`, `GET/PATCH/DELETE /api/campaigns/:id`.
  → skills : `brainstorming`, `test-driven-development`, `code-review`
- Backend : validation des payloads avec Zod, y compris les bornes de cadence (`mails_per_day`, `start_hour`, `pause_ms`).
  → skills : `test-driven-development`
- Backend : machine à états des campagnes — `draft → scheduled → running → paused → running → completed`. Refuser toute transition non autorisée avec un 409.
  → skills : `brainstorming`, `test-driven-development`, `code-review`
- Backend : moteur de rendu de template (mail merge). Variables `{{contact_name}}`, `{{company_name}}`, `{{salutation}}`, `{{email}}`. Échappement HTML systématique des valeurs injectées.
  → skills : `test-driven-development`, `security-review`
- Backend : `POST /api/campaigns/:id/preview` — rend le template avec un contact réel ou un contact fictif.
  → skills : `test-driven-development`
- Frontend : liste des campagnes (états, compteurs, actions).
  → skills : `frontend-design`, `composition-patterns`, `react-best-practices`
- Frontend : formulaire de création — nom, sujet, corps.
  → skills : `frontend-design`, `cro`, `web-design-guidelines`
- Frontend : éditeur de template riche (react-quill), avec insertion de variables en un clic et repli sur un éditeur texte brut.
  → skills : `brainstorming`, `frontend-design`, `composition-patterns`, `emil-design-eng`, `react-best-practices`
- Frontend : panneau d'aperçu, avec sélecteur du contact d'aperçu.
  → skills : `frontend-design`, `taste-skill`
- Frontend : formulaire de configuration d'envoi — mails/jour, heure de départ, pause entre envois, avec valeurs par défaut du CDC (46, 9 h, 3000 ms).
  → skills : `frontend-design`, `web-design-guidelines`, `cro`
- Contenu : templates de démarrage fournis à l'utilisateur (candidature spontanée, prospection B2B, relance).
  → skills : `copywriting`, `cold-email`, `emails`, `copy-editing`
- Tests : rendu de template (variable manquante, valeur contenant du HTML, accents), transitions d'état interdites.
  → skills : `test-driven-development`, `verification-before-completion`

### Definition of Done

→ skills : `verification-before-completion`, `requesting-code-review`, `simplify`

- Cycle complet créer → éditer → supprimer une campagne depuis l'interface.
- Une variable non fournie ne casse pas le rendu (repli documenté, pas de `{{contact_name}}` visible dans l'email).
- Une valeur de contact contenant `<script>` est échappée dans l'aperçu et dans le corps final.
- Un `PATCH` sur une campagne `running` qui modifie le corps du message est rejeté ou explicitement versionné.

---

## Phase 3 — Contacts CSV et pièces jointes

**Objectif** : importer 200+ contacts en moins d'une minute et attacher un CV à la campagne.

### Lots de travail

- Backend : `POST /api/campaigns/:id/contacts/import` — parsing CSV en flux, insertion par lots (`COPY` ou insert multi-valeurs).
  → skills : `brainstorming`, `test-driven-development`, `code-review`
- Backend : normalisation et validation des emails, détection des doublons dans le fichier et vis-à-vis des contacts déjà en base.
  → skills : `test-driven-development`
- Backend : rapport d'import — lignes acceptées, lignes rejetées avec numéro de ligne et motif.
  → skills : `test-driven-development`
- Backend : `GET /api/campaigns/:id/contacts` avec pagination, filtre par statut, recherche.
  → skills : `test-driven-development`
- Backend : `PATCH` et `DELETE` sur un contact ; `POST` d'ajout manuel.
  → skills : `test-driven-development`
- Backend : upload de pièce jointe — `POST /api/campaigns/:id/upload-cv`, `GET /api/campaigns/:id/cv`. Limite de taille (10 Mo), liste blanche de types MIME (PDF, DOCX), nom de fichier assaini.
  → skills : `security-review`, `test-driven-development`
- Backend : mise à jour de `total_contacts` sur la campagne à chaque import ou suppression.
  → skills : `test-driven-development`
- Frontend : glisser-déposer du CSV, mapping des colonnes vers les champs, aperçu des 5 premières lignes avant validation.
  → skills : `brainstorming`, `frontend-design`, `onboarding`, `emil-design-eng`, `composition-patterns`
- Frontend : affichage du rapport d'import, avec téléchargement des lignes rejetées.
  → skills : `frontend-design`, `web-design-guidelines`
- Frontend : tableau des contacts — statut, date d'envoi, message d'erreur, actions « ignorer » et « renvoyer ».
  → skills : `frontend-design`, `composition-patterns`, `react-best-practices`
- Frontend : upload du CV avec barre de progression et aperçu du fichier attaché.
  → skills : `frontend-design`, `motion-design`, `emil-design-eng`
- Frontend : retours utilisateur non bloquants sur import et upload (succès, erreurs partielles).
  → skills : `ask-sonner`
- Tests : CSV de 500 lignes, CSV avec BOM, séparateur `;`, emails invalides, doublons, fichier vide.
  → skills : `test-driven-development`, `verification-before-completion`

### Definition of Done

→ skills : `verification-before-completion`, `requesting-code-review`, `security-review`

- Import de 200 contacts en moins de 60 s, mesuré.
- Un CSV partiellement invalide importe les lignes valides et rapporte précisément les autres.
- Le CV est téléversé, listé, remplaçable et supprimable.
- Un fichier de 20 Mo ou de type `.exe` est refusé avec un message clair.

---

## Phase 4 — Moteur d'envoi

**Objectif** : lancer une campagne et voir les emails partir réellement, à la cadence configurée, sans dépasser le quota Gmail.

C'est la phase la plus risquée du projet. Elle mérite le plus de tests, et la revue de code la plus stricte.

### Lots de travail

- Conception du moteur d'envoi : cadence, idempotence, reprise après incident, gestion des quotas. Écrire le plan avant le code.
  → skills : `brainstorming`, `writing-plans`
- Backend : `POST /api/campaigns/:id/start`, `/pause`, `/resume`.
  → skills : `executing-plans`, `test-driven-development`
- Backend : BullMQ — file `campaign-dispatch` (planifie la journée) et file `email-send` (envoie un email).
  → skills : `executing-plans`, `test-driven-development`, `code-review`
- Backend : job planificateur quotidien (cron BullMQ) qui, pour chaque campagne `running`, prend au maximum `mails_per_day` contacts `pending` et programme un job par contact, espacé de `pause_ms` à partir de `start_hour`.
  → skills : `test-driven-development`, `code-review`
- Backend : service d'envoi Gmail — construction du message MIME (`multipart/mixed`) avec corps HTML, corps texte et pièce jointe, encodage base64url, appel `users.messages.send`.
  → skills : `test-driven-development`, `systematic-debugging`
- Backend : idempotence — verrou sur le contact et contrainte d'unicité par `(campaign_id, contact_id)` sur les jobs d'envoi. Un contact ne doit jamais recevoir deux fois le même email, même après un redémarrage du worker.
  → skills : `brainstorming`, `test-driven-development`, `code-review`, `caveman-review`
- Backend : politique de retry — 3 tentatives, backoff exponentiel. Distinguer erreurs permanentes (adresse invalide, 400) qui passent le contact en `failed` immédiatement, et erreurs transitoires (429, 5xx) qui sont retentées.
  → skills : `test-driven-development`, `systematic-debugging`
- Backend : compteur de quota journalier par utilisateur, avec pause automatique de la campagne à l'approche de `GMAIL_DAILY_LIMIT`.
  → skills : `test-driven-development`, `code-review`
- Backend : écriture d'un `log` pour chaque événement (`sent`, `error`, `bounce`), et mise à jour de `sent_count` / `error_count` de façon transactionnelle.
  → skills : `test-driven-development`
- Backend : passage automatique en `completed` quand plus aucun contact n'est `pending`.
  → skills : `test-driven-development`
- Frontend : bouton « Lancer la campagne » avec écran de confirmation récapitulatif (nombre de contacts, cadence, date de fin estimée).
  → skills : `frontend-design`, `cro`, `web-design-guidelines`
- Frontend : contrôles pause et reprise, avec état en temps réel (polling à intervalle raisonnable, ou SSE).
  → skills : `frontend-design`, `react-best-practices`, `composition-patterns`
- Frontend : avertissement de conformité et de délivrabilité avant le premier lancement d'une campagne.
  → skills : `copywriting`, `web-design-guidelines`
- Tests : envoi simulé de 50 contacts avec l'API Gmail mockée ; coupure du worker en milieu de campagne puis redémarrage (aucun doublon) ; quota atteint ; token expiré en cours de campagne.
  → skills : `test-driven-development`, `systematic-debugging`, `verification-before-completion`
- Test réel : campagne de 5 emails vers des adresses de test contrôlées.
  → skills : `run`, `verify-and-stop`

### Definition of Done

→ skills : `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `security-review`

- Une campagne de 46 emails part sur une journée, à la cadence configurée, sans erreur.
- Un worker tué et relancé ne produit aucun doublon (vérifié par requête SQL sur `logs`).
- Un token expiré est rafraîchi en cours de route sans perte d'email.
- L'atteinte du quota met la campagne en `paused` et l'utilisateur en est informé.
- Chaque contact traité porte un statut final cohérent, et `sent_count + error_count` correspond au nombre de contacts non `pending` et non `ignored`.

### Risques

- **Quota et réputation Gmail** : un envoi trop agressif entraîne un blocage temporaire du compte de l'utilisateur. **Parade** : plafond dur côté serveur, jitter aléatoire sur `pause_ms`, et avertissement explicite dans l'interface.
- **Classement en spam** : un même corps envoyé 200 fois est un signal négatif. **Parade** : documenter la nécessité de personnaliser, et prévoir la variation de contenu en Post-MVP. → skills : `cold-email`, `emails`
- **Conformité anti-spam** : selon les destinataires et les juridictions (CAN-SPAM, RGPD, LCAP), un email commercial non sollicité expose l'utilisateur. **Parade** : CGU explicites, avertissement dans l'interface avant le premier lancement, et champ de désinscription recommandé dans le template.

---

## Phase 5 — Dashboard et statistiques

**Objectif** : l'utilisateur comprend d'un coup d'œil où en sont ses campagnes.

### Lots de travail

- Backend : `GET /api/campaigns/:id/stats` — envoyés, erreurs, en attente, ignorés, taux d'erreur, prochain envoi programmé, date de fin estimée.
  → skills : `test-driven-development`, `code-review`
- Backend : agrégats du dashboard — nombre de campagnes, emails envoyés aujourd'hui, quota restant.
  → skills : `test-driven-development`
- Backend : export CSV des logs d'une campagne.
  → skills : `test-driven-development`
- Frontend : dashboard — cartes de synthèse, liste des campagnes actives, prochains envois.
  → skills : `brainstorming`, `frontend-design`, `dataviz`, `taste-skill`, `composition-patterns`
- Frontend : page de détail campagne — barre de progression, courbe d'envoi par jour (chart.js), tableau des contacts filtrable.
  → skills : `dataviz`, `frontend-design`, `react-best-practices`
- Frontend : bouton d'export des logs.
  → skills : `frontend-design`
- Frontend : états vides, états de chargement, états d'erreur sur chaque écran.
  → skills : `frontend-design`, `web-design-guidelines`, `emil-design-eng`, `copywriting`
- Frontend : passe responsive complète, mobile et desktop.
  → skills : `web-design-guidelines`, `frontend-design`
- Frontend : transitions et micro-animations de progression (barre d'avancement, mise à jour des compteurs).
  → skills : `motion-design`, `animate`, `apple-design`
- Repérage des endroits où une animation apporte de la clarté, sans en ajouter partout.
  → skills : `find-animation-opportunities`, `motion-doctrine`

### Definition of Done

→ skills : `verification-before-completion`, `requesting-code-review`, `simplify`, `web-design-guidelines`

- Les chiffres du dashboard correspondent aux données en base, vérifié sur un jeu de test.
- Toutes les pages sont utilisables à 375 px de large.
- Aucun écran ne présente de zone blanche sans explication en cas d'absence de données ou d'erreur réseau.

---

## Phase 6 — Sécurité, RGPD et quotas

**Objectif** : l'application peut recevoir des utilisateurs réels sans exposer leurs données ni leur compte Google.

### Lots de travail

- Revue de sécurité complète : contrôle d'accès sur chaque route, injections SQL, XSS dans les templates et les valeurs CSV, IDOR sur les identifiants de campagne et de contact.
  → skills : `security-review`, `code-review`, `caveman-review`
- Rotation des clés de chiffrement documentée, et procédure en cas de compromission.
  → skills : `security-review`
- `DELETE /api/users/me` — purge en cascade des campagnes, contacts, logs et fichiers ; révocation du token Google auprès de Google.
  → skills : `brainstorming`, `test-driven-development`, `security-review`
- `GET /api/users/me/export` — export complet des données de l'utilisateur (JSON + CSV).
  → skills : `test-driven-development`
- Rédaction des CGU et de la politique de confidentialité : données collectées, finalité, durée de conservation, sous-traitants, droits de l'utilisateur.
  → skills : `copywriting`, `copy-editing`
- Bandeau de consentement et acceptation explicite des CGU à la première connexion.
  → skills : `frontend-design`, `signup`, `web-design-guidelines`, `copywriting`
- Journal d'audit des actions sensibles (lancement de campagne, suppression de compte, export).
  → skills : `test-driven-development`, `security-review`
- Vérification des en-têtes de sécurité (CSP, HSTS) et de la configuration cookies en production.
  → skills : `security-review`
- Politique de conservation : purge automatique des logs de plus de 12 mois.
  → skills : `test-driven-development`, `schedule`

### Definition of Done

→ skills : `verification-before-completion`, `security-review`, `receiving-code-review`

- La suppression de compte ne laisse aucune ligne rattachée à l'utilisateur, vérifié par requête SQL.
- Le token Google est effectivement révoqué côté Google après suppression.
- Un audit de sécurité (`security-review` sur le diff complet, plus revue manuelle) ne remonte aucune vulnérabilité de sévérité haute ou critique.
- Les CGU et la politique de confidentialité sont publiées et accessibles depuis l'application.

---

## Phase 7 — Tests, observabilité et documentation

**Objectif** : l'équipe peut diagnostiquer un incident en production sans lire le code.

### Lots de travail

- Tests unitaires : rendu de template, parsing CSV, calcul de cadence, machine à états, chiffrement.
  → skills : `test-driven-development`
- Tests d'intégration : routes API sur base de test éphémère.
  → skills : `test-driven-development`
- Tests end-to-end (Playwright) : parcours complet login → création → import → lancement → suivi, avec l'API Gmail mockée.
  → skills : `test-driven-development`, `run`
- Objectif de couverture : 70 % global, 90 % sur `services/` (moteur d'envoi, template, CSV).
  → skills : `verification-before-completion`
- Logs structurés JSON (pino), avec identifiant de corrélation par requête et par job.
  → skills : `systematic-debugging`
- Rapport d'erreurs (Sentry) sur le front et le back.
  → skills : aucun
- Endpoint `/health` et `/ready`, et supervision de la profondeur de la file.
  → skills : `test-driven-development`
- Alertes : taux d'erreur d'envoi supérieur à 5 %, file bloquée, worker arrêté.
  → skills : `analytics`
- Passe de simplification sur le code accumulé pendant les phases 1 à 6.
  → skills : `simplify`, `safe-refactor`, `caveman-review`
- `README.md` : présentation, prérequis, installation locale, variables d'environnement, commandes.
  → skills : `writing-skills`
- `CONTRIBUTING.md` : conventions de branches, de commits, processus de PR.
  → skills : `writing-skills`
- `docs/RUNBOOK.md` : incidents fréquents et procédures — campagne bloquée, token révoqué, file saturée, quota atteint, rejeu d'un envoi.
  → skills : `writing-skills`, `systematic-debugging`
- `docs/ARCHITECTURE.md` : schéma des composants et du flux d'envoi.
  → skills : `writing-skills`, `artifact-diagramming`
- Mise à jour du `CLAUDE.md` du projet avec les pièges rencontrés pendant le développement.
  → skills : `init`

### Definition of Done

→ skills : `verification-before-completion`, `requesting-code-review`

- La CI exécute tous les tests et échoue si la couverture régresse.
- Le parcours end-to-end passe en CI.
- Une erreur d'envoi provoquée volontairement remonte dans Sentry avec assez de contexte pour être diagnostiquée.
- Un développeur extérieur installe le projet en local en suivant uniquement le README.

---

## Phase 8 — Déploiement production et alpha test

**Objectif** : l'application est en ligne, sauvegardée, et utilisée par de vrais bêta-testeurs.

### Lots de travail

- Provisionner Railway : service backend, Postgres, worker BullMQ en process séparé.
  → skills : aucun
- Provisionner les services de production : base Postgres, Redis (Upstash) et bucket R2. Trancher à ce moment si Neon reste la base de production ou si elle passe sur une offre sans scale-to-zero. Déployer le backend Railway dans une région **US East** : les trois services de données sont en us-east-1, et une API en Europe ajouterait un aller-retour transatlantique à chaque requête et chaque opération de queue.
  → skills : aucun
- Déployer le frontend sur Vercel, configurer le domaine et le HTTPS.
  → skills : aucun
- Renseigner tous les secrets en production, et vérifier qu'aucun secret n'est présent dans le dépôt (`git log` inclus).
  → skills : `security-review`
- Ajouter les URIs de redirection de production dans la console Google Cloud.
  → skills : aucun
- Exécuter les migrations en production, et vérifier la sauvegarde quotidienne de Postgres.
  → skills : `migration`
- Tester une restauration de sauvegarde sur une base jetable. Une sauvegarde non testée n'est pas une sauvegarde.
  → skills : `verify-and-stop`
- Déploiement automatique depuis `main`, avec procédure de rollback documentée.
  → skills : `writing-skills`
- Smoke test de production : login réel, campagne de 3 emails vers des adresses de test.
  → skills : `run`, `verify-and-stop`
- Recruter 5 à 10 bêta-testeurs, préparer un guide de prise en main et un canal de retours.
  → skills : `customer-research`, `onboarding`, `copywriting`
- Instrumenter les parcours clés pour mesurer les critères de succès du CDC.
  → skills : `analytics`
- Suivre les critères de succès du CDC : création de campagne en moins de 5 minutes, moins de 2 % d'erreurs d'envoi, latence API sous 200 ms.
  → skills : `analytics`, `verification-before-completion`
- Traiter les retours de l'alpha : trier, reproduire, corriger.
  → skills : `investigate-first`, `systematic-debugging`, `surgical-patch`, `verify-and-stop`
- Préparer le lancement public : page de présentation, annonce, canaux.
  → skills : `launch`, `product-marketing`, `copywriting`, `public-relations`
- Clôturer les branches de développement du MVP.
  → skills : `finishing-a-development-branch`

### Definition of Done

→ skills : `verification-before-completion`, `verify-and-stop`

- L'application est accessible sur son domaine, en HTTPS, et le parcours complet fonctionne en production.
- La restauration de sauvegarde a été testée avec succès, et la date du test est consignée.
- Au moins 5 bêta-testeurs ont mené une campagne réelle à son terme.
- Aucune anomalie bloquante ou critique n'est ouverte.

---

## Phase 9 — Post-MVP

À prioriser selon les retours de l'alpha, pas selon l'ordre de cette liste.

**Priorité haute** — demandes probables des utilisateurs :

- Templates réutilisables, sauvegardés au niveau du compte.
  → skills : `brainstorming`, `composition-patterns`, `test-driven-development`
- Séquences d'emails multi-étapes (relance automatique après N jours sans réponse).
  → skills : `brainstorming`, `cold-email`, `emails`, `writing-plans`, `test-driven-development`
- Détection de réponse via l'API Gmail, pour arrêter les relances sur un contact qui a répondu.
  → skills : `brainstorming`, `test-driven-development`, `systematic-debugging`
- Rate limiting intelligent : détection de dégradation d'envoi et pause automatique.
  → skills : `brainstorming`, `analytics`, `test-driven-development`

**Vérification des destinataires** (décidé le 22 septembre 2026 : vérification à l'import, puis revalidation au lancement) :

- Vérification locale à l'import du CSV et à l'ajout manuel : syntaxe, existence du domaine, enregistrements MX, domaines jetables connus, adresses de rôle. Gratuite, faite par le backend (`node:dns`), sans service tiers. Un statut par contact : `valid`, `risky`, `invalid`, `unknown`, avec la date et le motif. Migration avec rollback.
  → skills : `brainstorming`, `test-driven-development`, `migration`, `security-review`
- Revalidation au lancement : toute adresse vérifiée il y a plus de 30 jours est revérifiée avant que la campagne parte. `LaunchDialog` affiche le décompte (valides, à risque, exclues) avant le clic.
  → skills : `test-driven-development`, `frontend-design`, `verification-before-completion`
- Exclusion des adresses `invalid` au lancement, décision explicite de l'utilisateur pour les adresses `risky` (accept-all, rôle, inconnu). Une adresse exclue passe au statut `ignored` avec son motif, jamais supprimée en silence.
  → skills : `test-driven-development`, `emil-design-eng`
- Liste de suppression par compte : une adresse qui a répondu « stop », rejetée ou retirée à la main n'est plus jamais importée ni envoyée. Contrôlée à l'import et dans le moteur d'envoi, avant la réclamation du contact.
  → skills : `brainstorming`, `test-driven-development`, `migration`, `security-review`
- Vérification SMTP déléguée à MailFind (voir le bloc suivant) : la vérification de boîte ne peut pas être faite depuis Railway, qui bloque le port 25 sortant, et sonder des serveurs de messagerie depuis l'IP du backend dégraderait sa réputation. Option par compte, désactivée par défaut, mentionnée comme sous-traitant dans la politique de confidentialité.
  → skills : `brainstorming`, `security-review`, `test-driven-development`

**Intégration avec MailFind** (projet séparé, décidé le 22 septembre 2026, dépôt `MailFind`) :

MailFind collecte les adresses professionnelles des entreprises et les vérifie. Campaign Mailer reste l'outil d'envoi. Le lien entre les deux passe par une API versionnée, jamais par une base partagée : chaque application garde son propre modèle de données et ses propres risques.

- Jetons d'intégration personnels : créés et révoqués depuis la page Compte, affichés une seule fois, stockés hachés (SHA-256), portée limitée (`campaigns:write`, `contacts:write`), date de dernière utilisation. Aucune session Google n'est partagée avec MailFind.
  → skills : `brainstorming`, `security-review`, `test-driven-development`, `migration`
- API publique `v1` sous `/api/v1`, authentifiée par jeton : `POST /api/v1/campaigns` crée un brouillon avec ses contacts, `POST /api/v1/campaigns/:id/contacts` ajoute des contacts à un brouillon. Mêmes règles que l'import CSV (validation, doublons, 2 000 lignes par appel comme `IMPORT_BATCH_LIMIT`), en-tête `Idempotency-Key` obligatoire, limitation de débit par jeton. Une campagne créée par l'API reste un brouillon : seul l'utilisateur la lance, depuis l'interface.
  → skills : `anthropic-skills:nodejs-backend-patterns`, `test-driven-development`, `security-review`
- Champs transmis par MailFind : `email`, `contact_name`, `company_name`, `salutation`, et en plus `source` (URL où l'adresse a été trouvée), `verification_status` et `verified_at`. Ces trois champs alimentent directement le statut de vérification ci-dessus, sans revérifier une adresse vérifiée par MailFind depuis moins de 30 jours.
  → skills : `test-driven-development`, `migration`
- Documentation OpenAPI de l'API `v1`, publiée avec l'application, et tests de contrat partagés avec MailFind.
  → skills : `anthropic-skills:write-api-reference`, `anthropic-skills:openapi-regen`
- Interface : un encart « Importé depuis MailFind » sur la campagne, avec l'entreprise et la source de chaque contact dans le tableau des contacts.
  → skills : `frontend-design`, `composition-patterns`

**Priorité moyenne** :

- Tracking des ouvertures et des clics. Nécessite soit un pixel et un service de redirection auto-hébergé, soit un basculement vers SendGrid ou Mailgun. Décision d'architecture à documenter avant l'implémentation : le tracking par pixel dégrade la délivrabilité et impose une mention RGPD.
  → skills : `brainstorming`, `writing-plans`, `analytics`, `attribution`, `security-review`
- Statistiques par campagne : taux d'ouverture, de clic, de bounce.
  → skills : `dataviz`, `analytics`, `frontend-design`
- A/B testing des sujets.
  → skills : `ab-testing`, `cold-email`, `copywriting`, `test-driven-development`
- Export des statistiques en PDF et CSV.
  → skills : `dataviz`, `test-driven-development`

**Priorité basse** :

- Notifications Slack sur envoi et erreur.
  → skills : `test-driven-development`
- Re-targeting des contacts non ouverts.
  → skills : `emails`, `cold-email`, `analytics`
- Support des comptes Google Workspace avec quota à 1500/jour, avec détection automatique du type de compte.
  → skills : `test-driven-development`, `systematic-debugging`
- Compte de service pour les organisations.
  → skills : `brainstorming`, `security-review`
- Modèle économique et tarification, si le produit passe en offre payante.
  → skills : `pricing`, `offers`, `paywalls`, `product-marketing`

---

## Registre des risques du projet

| Risque                                          | Impact                                         | Probabilité | Parade                                                                                                                                 | Skills                                     |
| ----------------------------------------------- | ---------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Vérification OAuth Google longue ou refusée     | Bloque le lancement public                     | Moyenne     | Demande déposée en Phase 0. Rester en mode Testing (100 utilisateurs) pour l'alpha. Prévoir un plan B avec mot de passe d'application. | —                                          |
| Blocage du compte Gmail d'un utilisateur        | Perte de confiance forte                       | Moyenne     | Plafond dur, jitter, avertissement explicite avant le premier envoi.                                                                   | `test-driven-development`                  |
| Emails classés en spam                          | L'outil ne remplit pas sa promesse             | Élevée      | Personnalisation obligatoire, conseils de délivrabilité dans l'interface, lien de désinscription.                                      | `cold-email`, `emails`, `copywriting`      |
| Doublons d'envoi après incident                 | Dommage réputationnel pour l'utilisateur       | Moyenne     | Idempotence traitée en Phase 4, testée par coupure de worker.                                                                          | `test-driven-development`, `code-review`   |
| Usage abusif de l'outil pour du spam de masse   | Risque juridique et de blocage de l'app Google | Moyenne     | CGU, plafond global par compte, journal d'audit, procédure de signalement.                                                             | `security-review`, `copywriting`           |
| Dérive du périmètre vers les fonctions Post-MVP | Retard du MVP                                  | Élevée      | Aucune fonction de Phase 9 avant la validation de la Phase 8.                                                                          | `lean-build`                               |
| Un seul développeur sur le moteur d'envoi       | Point de défaillance unique                    | Moyenne     | Revue de code obligatoire sur `services/`, runbook rédigé en Phase 7.                                                                  | `requesting-code-review`, `writing-skills` |

---

## Jalons de validation

| Jalon                       | Condition                                                                | Fin de phase |
| --------------------------- | ------------------------------------------------------------------------ | ------------ |
| M1 — Socle prêt             | CI verte, décisions gelées, OAuth configuré                              | 0            |
| M2 — Connexion réelle       | Un compte Google se connecte, refresh token chiffré en base              | 1            |
| M3 — Campagne préparable    | Créer une campagne, importer 200 contacts, attacher un CV, voir l'aperçu | 3            |
| M4 — Premier envoi réel     | 5 emails partis vers des adresses de test, statuts corrects              | 4            |
| M5 — MVP fonctionnel        | Suivi complet, responsive, statistiques justes                           | 5            |
| M6 — Prêt pour utilisateurs | Sécurité auditée, RGPD couvert, tests et runbook en place                | 7            |
| M7 — En production          | URL publique, sauvegarde restaurée avec succès, alpha lancée             | 8            |
| M8 — Lancement public       | Retours alpha traités, aucune anomalie bloquante                         | 8            |

---

## Index des skills par domaine

Vue inverse, pour retrouver rapidement où un skill intervient.

| Domaine                | Skills                                                                                                                            | Phases              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Discipline de travail  | `brainstorming`, `writing-plans`, `executing-plans`, `lean-build`, `verification-before-completion`, `verify-and-stop`            | toutes              |
| Tests                  | `test-driven-development`                                                                                                         | 0–9                 |
| Revue et qualité       | `code-review`, `caveman-review`, `simplify`, `requesting-code-review`, `receiving-code-review`, `safe-refactor`, `surgical-patch` | 1–9                 |
| Sécurité               | `security-review`                                                                                                                 | 1, 2, 3, 4, 6, 8, 9 |
| Débogage               | `investigate-first`, `systematic-debugging`                                                                                       | 1, 4, 7, 8, 9       |
| Design UI              | `frontend-design`, `taste-skill`, `web-design-guidelines`, `theme-factory`, `emil-design-eng`, `apple-design`                     | 1, 2, 3, 5, 6       |
| React                  | `react-best-practices`, `composition-patterns`, `ask-sonner`                                                                      | 1, 2, 3, 5          |
| Animation              | `motion-design`, `motion-doctrine`, `animate`, `find-animation-opportunities`                                                     | 1, 3, 5             |
| Data / graphiques      | `dataviz`                                                                                                                         | 5, 9                |
| Conversion et parcours | `cro`, `signup`, `onboarding`                                                                                                     | 1, 2, 3, 4, 6, 8    |
| Contenu email          | `copywriting`, `copy-editing`, `cold-email`, `emails`                                                                             | 2, 4, 6, 8, 9       |
| Mesure                 | `analytics`, `attribution`, `ab-testing`                                                                                          | 7, 8, 9             |
| Lancement              | `launch`, `product-marketing`, `public-relations`, `customer-research`                                                            | 8                   |
| Monétisation           | `pricing`, `offers`, `paywalls`                                                                                                   | 9                   |
| Infra & données        | `migration`, `schedule`                                                                                                           | 0, 6, 8             |
| Documentation          | `writing-skills`, `artifact-diagramming`, `init`                                                                                  | 0, 7                |
| Exécution réelle       | `run`                                                                                                                             | 1, 4, 7, 8          |
| Git & parallélisation  | `finishing-a-development-branch`, `using-git-worktrees`, `dispatching-parallel-agents`, `cavecrew`                                | toutes              |
| Commits                | `caveman-commit`                                                                                                                  | toutes              |
| Environnement agent    | `fewer-permission-prompts`, `update-config`                                                                                       | 0                   |

---

## Première action

Ouvrir la Phase 0 : valider le tableau des décisions techniques, configurer l'identité git, puis premier commit du squelette monorepo.
