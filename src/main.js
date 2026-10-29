const { invoke } = window.__TAURI__.core;

const addConfigBtn = document.getElementById('add_config_button');
const stateEmpty = document.getElementById('state-empty');
const stateLoaded = document.getElementById('state-loaded');

function updateConfigUI(hasConfig) {
  if (hasConfig) {
    stateEmpty.classList.add('hidden');
    stateLoaded.classList.remove('hidden');
  } else {
    stateEmpty.classList.remove('hidden');
    stateLoaded.classList.add('hidden');
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const exists = await invoke('check_config');
    updateConfigUI(exists);
  } catch (error) {
    console.error('Ошибка проверки конфига:', error);
  }
});

addConfigBtn.addEventListener("click", async () => {
  try {
    addConfigBtn.disabled = true;

    const exists = await invoke('add_config');
    console.log('Ответ от Rust:', exists);

    updateConfigUI(exists);

  } catch (error) {
    console.error('Ошибка добавления конфига:', error);
  } finally {
    addConfigBtn.disabled = false;
  }
})

const enableButton = document.getElementById('enable_button');
const enableText = document.getElementById('enable_text');
const powerCircle = document.querySelector('.power-circle');

let isRunning = false;

enableButton.addEventListener("click", async () => {

  const setLabel = (text) => {
    if (enableText) enableText.textContent = text;
    else enableButton.textContent = text;
  };

  try {
    enableButton.disabled = true;
    enableButton.classList.remove('error');
    enableButton.classList.add('loading');
    if (powerCircle) {
      powerCircle.classList.remove('error', 'active');
      powerCircle.classList.add('loading');
    }

    if (!isRunning) {
      setLabel('Подключение...');
      await invoke('enable');

      isRunning = true;
      setLabel('Выключить');
      enableButton.classList.add('active');
      if (powerCircle) powerCircle.classList.add('active');
    } else {
      setLabel('Отключение...');
      await invoke('disable');

      isRunning = false;
      setLabel('Включить');
      enableButton.classList.remove('active');
    }
  } catch (error) {
    console.error('Ошибка переключения:', error);
    enableButton.classList.add('error');
    if (powerCircle) powerCircle.classList.add('error');

    setLabel(`Ошибка: ${error}`);
    setTimeout(() => {
      enableButton.classList.remove('error');
      if (powerCircle) powerCircle.classList.remove('error');
      setLabel(isRunning ? 'Выключить' : 'Включить');
    }, 3000);
  } finally {
    enableButton.classList.remove('loading');
    if (powerCircle) powerCircle.classList.remove('loading');
    enableButton.disabled = false;
  }
});