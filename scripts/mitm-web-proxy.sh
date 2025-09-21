

mitmweb --listen-host 0.0.0.0 --listen-port 3000 \
    --mode reverse:http://127.0.0.1:3003 --web-host 0.0.0.0 \
    --web-port 8081 --set block_global=false \
    --no-web-open-browser