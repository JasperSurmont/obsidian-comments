import { App, Editor, ItemView, MarkdownPostProcessorContext, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from 'obsidian';

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
		this.registerMarkdownPostProcessor(this.postProcessor)

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


		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new CommentSettingTab(this.app, this));
	}

	async activateView() {
		const { workspace } = this.app;
	
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_COMMENT);
	
		if (leaves.length > 0) {
		  leaf = leaves[0];
		} else {
		  leaf = workspace.getRightLeaf(false);
		  if (!leaf) return
		  await leaf.setViewState({ type: VIEW_TYPE_COMMENT, active: true });
		}
	
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

	postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		console.log("working")
		let callouts = el.findAll("callout")

		console.log(callouts.length)
	}

	editorExtension() {
		this.registerEditorExtension()
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