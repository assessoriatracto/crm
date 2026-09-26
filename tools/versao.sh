#!/usr/bin/env bash
# Atualiza a versão (?v=) de todos os arquivos do CRM e dos módulos compartilhados do site.
# Rode antes de cada commit que muda o CRM, ou quando db.js/forms.js/tracto-config.js mudarem no site,
# pra que o navegador de quem usa o CRM baixe a versão nova em vez da que está em cache.
set -euo pipefail
cd "$(dirname "$0")/.."
V="$(date +%y%m%d%H%M)"
perl -pi -e "s#\.(js|css)\?v=\d+#.\$1?v=$V#g" index.html assets/js/*.js
echo "versão $V"
