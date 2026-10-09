# TotalMail as its own image: production mode, no root, nothing of yours baked in.
#
# Build from the project folder:   docker build -f Dockerfile -t totalmail .
# or let docker-compose.yaml do it.
#
# Nothing here is native: Total.js, ImapFlow, mailparser and sanitize-html are plain JavaScript, so the small Alpine
# image is enough. Secrets and people never enter the image: `database/` is a volume; Microsoft and Google sign-in
# settings are entered in the app and encrypted there (see docs/installation.md).
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# The repository includes a public config; NODE_ENV above selects release mode. Only runtime data belongs to this user.
RUN mkdir -p database logs tmp \
	&& chown -R node:node /app

USER node

# The people, the mailboxes and the key that protects their passwords. Keep it, and back it up.
VOLUME ["/app/database"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:8000/health/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "index.js", "8000"]
