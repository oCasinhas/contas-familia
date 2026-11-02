# Contas da Família

App (PWA) para gerir as contas mensais da família: Pagar/Pago, lembretes, notificações, resumo por categoria, exportação para calendário (.ics) e cópia de segurança (JSON).

**Privacidade:** a app não contém dados pessoais. Tudo fica guardado apenas no dispositivo (localStorage + IndexedDB). Nada é enviado para nenhum servidor.

## Publicar no GitHub Pages
1. Criar um repositório (ex.: `contas-familia`) e enviar o conteúdo desta pasta para a raiz.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
3. Abrir `https://<utilizador>.github.io/contas-familia/` no Chrome do Android → menu ⋮ → **Instalar app** (ou o botão “Instalar app” dentro da app).
4. Na app: **Importar backup (.json)** e escolher o ficheiro de cópia de segurança.

## Atualizar a app
Alterar `VERSION` em `sw.js` sempre que mudar algum ficheiro. A app mostra “Nova versão disponível · Atualizar”.

## Notificações
- Avisos na app e notificações do sistema (via service worker) com a app aberta.
- Com a app instalada no Android, o Chrome pode fazer verificações periódicas em segundo plano (Periodic Background Sync, ~12 h; depende do Chrome e do uso da app).
- Método garantido: ⚙️ → *Exportar todos os lembretes para o calendário (.ics)*.
