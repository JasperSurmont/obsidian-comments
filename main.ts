import { App, Editor, ItemView, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from 'obsidian';

// Remember to rename these classes and interfaces!

interface CommentSettings {
	leftDelim: string
	rightDelim: string
}

const DEFAULT_SETTINGS: CommentSettings = {
	leftDelim: '{{',
	rightDelim: '}}'
}

const VIEW_TYPE_COMMENT = 'comment-view'

export default class Comment extends Plugin {
	settings: CommentSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Comments', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			this.activateView();
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('comment-ribbon-class');

		this.registerView(
			VIEW_TYPE_COMMENT,
			(leaf) => new CommentView(leaf)
		)

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new CommentModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new CommentModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CommentSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	async activateView() {
		const { workspace } = this.app;
	
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_COMMENT);
	
		if (leaves.length > 0) {
		  // A leaf with our view already exists, use that
		  leaf = leaves[0];
		} else {
		  // Our view could not be found in the workspace, create a new leaf
		  // in the right sidebar for it
		  leaf = workspace.getRightLeaf(false);
		  if (!leaf) return
		  await leaf.setViewState({ type: VIEW_TYPE_COMMENT, active: true });
		}
	
		// "Reveal" the leaf in case it is in a collapsed sidebar
		workspace.revealLeaf(leaf);
	  }

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class CommentModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class CommentSettingTab extends PluginSettingTab {
	plugin: Comment;

	constructor(app: App, plugin: Comment) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Comment delimiter left')
			.setDesc('How do you want a comment to start left?')
			.addText(text => text
				.setPlaceholder('{{')
				.setValue(this.plugin.settings.leftDelim)
				.onChange(async (value) => {
					this.plugin.settings.leftDelim = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
		.setName('Comment delimiter right')
		.setDesc('How do you want a comment to end right?')
		.addText(text => text
			.setPlaceholder('}}')
			.setValue(this.plugin.settings.rightDelim)
			.onChange(async (value) => {
				this.plugin.settings.rightDelim = value;
				await this.plugin.saveSettings();
			}));
	}
}

class CommentView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf)
	}

	getViewType() {
		return VIEW_TYPE_COMMENT
	}

	getDisplayText() {
		return 'Comment View'
	}

	async onOpen() {
		const container = this.containerEl.children[1]
		container.empty()
		container.createEl('h4', {text: 'Comment View'})
	}

	async onClose() {

	}
}