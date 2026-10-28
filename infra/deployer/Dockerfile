FROM docker:27-cli
RUN apk add --no-cache git openssh-client openssh-keygen gnupg
COPY deploy.sh /deploy.sh
CMD ["/bin/sh", "/deploy.sh"]
