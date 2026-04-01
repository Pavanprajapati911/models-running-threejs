// src/core/ModeController.js
export class ModeController {
  constructor({ envParams, character, editorController }) {
    this.envParams = envParams;
    this.character = character;
    this.editorController = editorController;

    // Reflect initial state immediately
    this.updateIndicator();
  }

  enterEditorMode() {
    this.envParams.mode.type = "editor";
    console.log("🛠️ Editor Mode ON");

    // Disable gameplay
    if (this.character) {
      if (this.character.gameCharacters) {
        this.character.gameCharacters.forEach(c => c.setEnabled ? c.setEnabled(false) : (c.enabled = false));
      } else {
        this.character.setEnabled ? this.character.setEnabled(false) : (this.character.enabled = false);
      }
    }

    // Enable free camera
    this.envParams.spectator.active = true;

    // Unlock mouse
    document.exitPointerLock();

    // Enable editor
    this.editorController.enable();

    // Show UI
    const editorUI = document.getElementById("editor-ui");
    if (editorUI) editorUI.style.display = "block";

    this.updateIndicator();
  }

  exitEditorMode() {
    this.envParams.mode.type = "runtime";
    console.log("🎮 Game Mode ON");

    // Enable gameplay
    if (this.character) {
      if (this.character.gameCharacters) {
        this.character.gameCharacters.forEach(c => c.setEnabled ? c.setEnabled(true) : (c.enabled = true));
      } else {
        this.character.setEnabled ? this.character.setEnabled(true) : (this.character.enabled = true);
      }
    }

    // Disable free camera
    this.envParams.spectator.active = false;

    // Disable editor
    this.editorController.disable();

    // Hide UI
    const editorUI = document.getElementById("editor-ui");
    if (editorUI) editorUI.style.display = "none";

    // Lock mouse
    document.body.requestPointerLock();

    this.updateIndicator();
  }

  toggleMode() {
    if (this.envParams.mode.type === "editor") {
      this.exitEditorMode();
    } else {
      this.enterEditorMode();
    }
  }

  updateIndicator() {
    const indicator = document.getElementById("mode-indicator");
    if (!indicator) return;

    const isEditor = this.envParams.mode.type === "editor";
    indicator.innerText = isEditor ? "🛠️  EDITOR MODE" : "🎮  RUNTIME MODE";
    indicator.style.background = isEditor
      ? "rgba(200, 120, 20, 0.75)"
      : "rgba(0, 0, 0, 0.55)";
    indicator.style.borderColor = isEditor
      ? "rgba(255, 180, 60, 0.4)"
      : "rgba(255,255,255,0.12)";
  }
}

