// Local visual QA fixture for Login screen
window.__TAURI__ = {
  core: {
    invoke: async (command) => {
      if (command === 'api_transport_encrypted') return true;
      if (command === 'restore_session') return null;
      if (command === 'get_settings') return { language: 'ru', bypassRu: true, adBlock: 'recommended', autoStartup: false, minimizeToTray: true, killSwitch: true };
      if (command === 'startup_enabled') return false;
      throw Error('QA auth mode');
    }
  }
};
