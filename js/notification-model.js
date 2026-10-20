/* Shared notification catalog: receiving a notification never grants module access. */
((root, factory) => {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.HubNotificationModel = value;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const types = {
    shiftCloseoutDue: {flag:'canReceiveShiftCloseoutDue', module:'shift-closeout', label:'Липсващи отчети преди края на смяната', text:'Смяната приключва скоро. Проверете липсващите отчети.'},
    shiftCloseoutOverdue: {flag:'canReceiveShiftCloseoutOverdue', module:'shift-closeout', label:'Липсващи отчети след края на смяната', text:'Смяната приключи. Все още има липсващи отчети.'},
    taskAssigned: {flag: 'canReceiveTaskAssigned', module: 'tasks', label: 'Възложени задачи', text: 'Имате възложена задача.', needs: ['canReportTasks']},
    taskChanged: {flag: 'canReceiveTaskChanged', module: 'tasks', label: 'Промени и връщане на задачи', text: 'Задачата е променена или върната за работа.', needs: ['canReportTasks']},
    taskReport: {flag: 'canReceiveTaskReport', module: 'tasks', label: 'Отчети и напредък по възложени задачи', text: 'Има нов отчет или напредък по задача.', needs: ['canAssignTasks', 'canManageTasks']},
    taskReview: {flag: 'canReceiveTaskReview', module: 'tasks', label: 'Задачи за проверка', text: 'Задача очаква проверка.', needs: ['canReviewTasks']},
    taskOutcome: {flag: 'canReceiveTaskOutcome', module: 'tasks', label: 'Одобрение и отмяна на задачи', text: 'Задачата е одобрена или отменена.', needs: ['canReportTasks']},
    taskDue: {flag: 'canReceiveTaskDue', module: 'tasks', label: 'Наближаващи срокове на задачи', text: 'Срокът на задача наближава.', needs: ['canReportTasks']},
    taskOverdue: {flag: 'canReceiveTaskOverdue', module: 'tasks', label: 'Просрочени задачи и липсващи отчети', text: 'Задача е с изтекъл срок и чака отчет.', needs: ['canReportTasks']},
    productionAdded: {flag: 'canReceiveProductionAdded', module: 'production-log', label: 'Въведен тонаж', text: 'Има нов производствен отчет.'},
    productionChanged: {flag: 'canReceiveProductionChanged', module: 'production-log', label: 'Корекции на производствени отчети', text: 'Производствен отчет е коригиран или изтрит.'},
    downtimeAdded: {flag: 'canReceiveDowntimeAdded', module: 'line-downtime', label: 'Нови престои', text: 'Има нов отчет за престой.'},
    downtimeChanged: {flag: 'canReceiveDowntimeChanged', module: 'line-downtime', label: 'Корекции на престои', text: 'Отчет за престой е коригиран или изтрит.'},
    pairs: {flag: 'canReceivePairNotifications', module: 'pair-targets', label: 'Планове и резултати на двойки', text: 'Има нов или променен запис за двойки.'},
    instructions: {flag: 'canReceiveInstructionNotifications', module: 'package-instructions', label: 'Обновени инструкции', text: 'Инструкциите са обновени.'},
    wallPost: {flag: 'canReceiveWallPosts', module: 'wall', label: 'Нови публикации на стената', text: 'Има нова публикация на стената.'},
    systemDatabase: {flag: 'canReceiveDatabaseNotifications', module: 'system-status', label: 'Проблем с базата', text: 'Работната база изисква проверка.'},
    systemDisk: {flag: 'canReceiveDiskNotifications', module: 'system-status', label: 'Недостатъчно място на диска', text: 'Свободното място изисква проверка.'},
    systemBackup: {flag: 'canReceiveBackupNotifications', module: 'system-status', label: 'Проблем с архивите', text: 'Архивите изискват проверка.'},
    systemUpdate: {flag: 'canReceiveUpdateNotifications', module: 'system-status', label: 'Проблем с обновяването', text: 'Обновяването изисква проверка.'},
    systemRecovery: {flag: 'canReceiveSystemRecovery', module: 'system-status', label: 'Възстановени системни проверки', text: 'Проверките на системата са възстановени.'}
  };
  const available = (type, user, model) => {
    const value = types[type], rights = model.permissionsFor(user);
    return !!value && rights.canViewNotifications && rights[value.flag] && model.canViewModule(user, value.module) && (!value.needs || value.needs.some(key => rights[key]));
  };
  const systemTargets = {systemDatabase: 'databaseCard', systemDisk: 'diskCard', systemBackup: 'backupCard', systemUpdate: 'updateCard', systemRecovery: 'systemSummary'};
  function href(type, target) {
    if (!types[type]) return '/notifications';
    const id = systemTargets[type] || target;
    return '/' + types[type].module + (typeof id === 'string' && id.length > 0 && id.length <= 1000 ? '?' + new URLSearchParams({target: id}) : '');
  }
  return {types, available, href};
});
