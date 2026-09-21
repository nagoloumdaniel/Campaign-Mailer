# Campaign Mailer — guide de prise en main

Bienvenue, et merci de tester Campaign Mailer.

L'application envoie vos campagnes d'e-mails **depuis votre propre compte Gmail**, une par une, à un rythme lent, pour que vos messages arrivent dans la boîte de réception et pas dans les spams.

Comptez 10 minutes pour votre première campagne.

---

## Avant de commencer

Il vous faut :

- un **compte Gmail personnel** (les comptes d'entreprise Google Workspace ne sont pas encore pris en charge) ;
- une **liste de contacts**, dans un fichier CSV, avec au minimum une colonne d'adresses e-mail ;
- éventuellement une **pièce jointe** : un CV ou un document, en PDF ou Word, 10 Mo au maximum.

L'application est à l'adresse <https://campaignmailer.vercel.app>.

Pendant la bêta, l'accès est réservé aux adresses enregistrées comme testeurs. Si Google affiche « accès bloqué » ou « application non validée », c'est que votre adresse n'a pas encore été ajoutée : signalez-le.

---

## 1. Se connecter

Cliquez sur **Se connecter avec Google**, puis choisissez votre compte.

Google vous demande d'autoriser l'**envoi d'e-mails en votre nom**. C'est la seule permission demandée : l'application **ne peut pas lire votre boîte de réception**, ni vos messages reçus.

À la première connexion, vous acceptez les conditions d'utilisation et la politique de confidentialité.

---

## 2. Créer une campagne

**Nouvelle campagne**, donnez-lui un nom (visible par vous seul, jamais par les destinataires), et choisissez un modèle ou partez d'un message vide.

Rédigez ensuite l'**objet** et le **message**. Vous pouvez insérer des variables, remplacées pour chaque contact :

| Variable           | Remplacée par     |
| ------------------ | ----------------- |
| `{{contact_name}}` | le nom du contact |
| `{{company_name}}` | son entreprise    |
| `{{salutation}}`   | sa civilité       |
| `{{email}}`        | son adresse       |

**Prévoyez toujours une valeur de repli** avec une barre verticale, pour les contacts dont l'information manque :

```
Bonjour {{salutation|Madame, Monsieur}},
Je vous écris au sujet de {{company_name|votre entreprise}}.
```

Sans repli, un contact sans entreprise recevrait une phrase amputée.

N'oubliez pas **Enregistrer**.

---

## 3. Importer vos contacts

Déposez votre fichier CSV dans la zone prévue, ou cliquez pour le choisir. Le séparateur et l'encodage sont détectés automatiquement.

Indiquez ensuite quelle colonne correspond à quoi. Seule la colonne des adresses est obligatoire.

Après l'import, un rapport indique combien de lignes ont été lues, combien de contacts ont été importés, et **quelles lignes ont été écartées, avec le motif** : adresse invalide, doublon, ligne vide. Corrigez votre fichier et réimportez si besoin, les doublons ne seront pas ajoutés deux fois.

---

## 4. Vérifier avec l'aperçu

La section **Aperçu** affiche le message tel qu'un contact le recevra, variables remplacées. Faites-le au moins une fois avant de lancer : c'est là que l'on repère une variable mal écrite ou un repli manquant.

---

## 5. Régler le rythme

Quatre réglages, dans **Rythme d'envoi** :

- **E-mails par jour** : commencez bas, 20 à 30 par jour sur un compte qui n'envoie pas beaucoup d'habitude.
- **Heure de départ** : l'heure à laquelle les envois commencent, dans le fuseau choisi.
- **Pause entre deux envois** : 30 secondes par défaut, 10 au minimum.
- **Fuseau horaire** : celui de vos destinataires, de préférence.

Ces limites ne sont pas décoratives. Gmail bloque un compte personnel au-delà de 500 envois sur 24 heures ; l'application s'arrête à 450, toutes campagnes confondues, et envoie à intervalle irrégulier pour ne pas ressembler à un robot.

---

## 6. Lancer et suivre

**Lancer la campagne**, relisez le récapitulatif, cochez la confirmation, et confirmez.

La page se met à jour toute seule : nombre d'envois, erreurs, progression, fin estimée. Vous pouvez **mettre en pause** puis **reprendre** à tout moment ; les contacts déjà traités ne sont jamais renvoyés.

Trois situations normales, qui ne sont pas des pannes :

- **« Plafond atteint »** : le compte a atteint sa limite sur 24 heures. La campagne reste active et repart toute seule quand la fenêtre se libère.
- **Rien ne part encore** : l'heure de départ n'est pas atteinte dans le fuseau choisi.
- **Un contact « en erreur »** : l'adresse a été refusée. Le motif est indiqué dans la liste des contacts.

Si l'application vous demande de **reconnecter votre compte Google**, faites-le puis cliquez sur **Reprendre** : rien n'est perdu.

---

## Vos données

- Vos e-mails partent de **votre compte**, et restent dans vos **Messages envoyés**.
- L'application **ne lit jamais** votre boîte de réception.
- Vos contacts servent uniquement à vos campagnes, ne sont jamais partagés, et les journaux sont supprimés au bout de douze mois.
- Depuis **Mon compte**, vous pouvez à tout moment **exporter toutes vos données** ou **supprimer votre compte**. La suppression retire aussi l'accès de l'application à votre compte Google.

---

## Ce que nous attendons de vos retours

Menez **une campagne réelle de bout en bout**, même petite. C'est le seul test qui compte.

Signalez en priorité :

1. tout e-mail **envoyé deux fois** au même destinataire, ou un envoi **manquant** ;
2. tout écran qui vous laisse **sans savoir quoi faire**, ou un message d'erreur incompréhensible ;
3. tout endroit où vous avez **hésité plus de quelques secondes** ;
4. le **temps** qu'il vous a fallu pour votre première campagne.

Si vous signalez un problème sur une campagne, indiquez **le nom de la campagne et l'heure approximative** : cela suffit à la retrouver dans les journaux.

Rappel légal : vous restez responsable des messages envoyés depuis votre compte, du respect du consentement de vos destinataires, et des demandes de désinscription.

Merci. Vos retours pendant cette bêta décident de ce qui sera corrigé avant l'ouverture au public.
