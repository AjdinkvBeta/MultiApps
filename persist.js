/* Fælles for alle MultiApps: bed browseren om at gemme data permanent ("persistent storage"),
   så billeder, planer og indstillinger ikke ryddes af browseren ved pladsmangel eller lang tids inaktivitet.
   Alle apps ligger på samme adresse og deler derfor lager og tilladelse. Inkludér i alle nye apps. */
(function () {
  var s = navigator.storage;
  window.maPersist = function () {
    if (!s || !s.persist) return Promise.resolve(false);
    return s.persisted().then(function (p) { return p || s.persist(); }).catch(function () { return false; });
  };
  window.maStorage = function () {
    return Promise.all([
      s && s.persisted ? s.persisted().catch(function () { return false; }) : false,
      s && s.estimate ? s.estimate().catch(function () { return {}; }) : {}
    ]).then(function (r) { return {persisted: r[0], usage: r[1].usage || 0, quota: r[1].quota || 0}; });
  };
  window.maPersist();
  // Nogle browsere giver først tilladelsen efter et tryk – prøv igen ved første tryk
  document.addEventListener('pointerdown', function once() { document.removeEventListener('pointerdown', once, true); window.maPersist(); }, true);
})();
