## Conectar o Raja ao Google Sheets

1. Crie uma planilha no Google Sheets.
2. Copie o ID da planilha (parte entre `/d/` e `/edit` na URL).
3. No Google Apps Script, crie um projeto e cole o arquivo `google-apps-script/Code.gs`.
4. Em `Code.gs`, preencha:
   - `SPREADSHEET_ID`
   - `DRIVE_FOLDER_ID` (opcional; se vazio, guarda apenas nomes das fotos)
5. Deploy:
   - `Deploy > New deployment`
   - Tipo: `Web app`
   - Execute as: `Me`
   - Who has access: `Anyone`
6. Copie a URL do Web App gerada.
7. No projeto web, edite `config.js`:

```js
window.RAJA_CONFIG = {
  sheetEndpoint: "COLE_AQUI_A_URL_DO_WEB_APP",
};
```

8. Reabra a página e teste:
   - Aceite do consentimento grava na aba `Consentimentos`.
   - Envio de observação grava na aba `Observacoes`.
   - Logs de requisição gravam na aba `Logs`.

## Observações

- O script cria automaticamente as abas se não existirem.
- Quando `DRIVE_FOLDER_ID` é configurado, as fotos são salvas no Drive e os links vão para a planilha.
- Se o endpoint estiver vazio, o front apenas valida e não envia.
- Sempre que alterar o `Code.gs`, publique uma **nova versão** no deploy da Web App.
