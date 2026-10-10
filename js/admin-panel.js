(() => {
  if (typeof HubServer === 'undefined' || HubServer.user.role !== 'admin') {
    document.getElementById('adminPanelMessage').textContent = 'Админ панелът е достъпен само за администратори в сървърен режим.';
    return;
  }
  const canImport = HubServer.can('canImportData'), canExport = HubServer.can('canExportReports');
  const transfer = document.getElementById('adminTransfer');
  transfer.hidden = !canImport && !canExport;
  const module = new URLSearchParams(location.search).get('module');
  if (['production-log','line-downtime','pair-targets'].includes(module)) transfer.href = 'data-import.html?module=' + module;
  if (!canImport || !canExport) document.getElementById('adminTransferDescription').textContent = canImport ? 'Добавяне и проверка на данни.' : 'Сваляне на текущите отчети.';
  document.getElementById('adminModules').hidden = false;
})();
