import { App, debounce, Debouncer, Editor, EditorPosition, EventRef, Events, ItemView, MarkdownPostProcessorContext, MarkdownView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, Vault, WorkspaceLeaf } from 'obsidian';

interface Comment {
	name: string
	content: string
	startPos: EditorPosition
	endPos: EditorPosition
}

interface AllComments {
	[key: string]: Comment[]
}

const VIEW_TYPE_COMMENT = 'comment-view'

export default class CommentPlugin extends Plugin {
	debounceUpdate = debounce(this.updateComments, 500, true)

	modifyListener: EventRef
	fileOpenListener: EventRef

	async onload() {
		this.registerMarkdownPostProcessor(this.postProcessor.bind(this))

		this.addRibbonIcon('dice', 'Comments', () => {
			this.activateView();
		});

		this.registerView(
			VIEW_TYPE_COMMENT,
			(leaf) => new CommentView(leaf, this)
		)
			
		this.modifyListener = this.app.vault.on('modify', file => {
			this.debounceUpdate(file)
		})

		this.fileOpenListener = this.app.workspace.on('file-open', file => {
			if (file) this.updateComments(file)}
		)

		this.addCommand({
			id: 'comment-add',
			name: 'Add new comment',
			editorCallback(editor, ctx) {
				editor.replaceRange(`> [!comment] NAME\n> COMMENT`, editor.getCursor())
			},
		})
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
		this.app.workspace.offref(this.modifyListener)
		this.app.workspace.offref(this.fileOpenListener)
	}

	postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		if (this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() == 'source') return;
		let callouts = el.findAll(".callout").filter(c => c.getAttribute('data-callout')?.toLowerCase() === 'comment')
		callouts.forEach(c => c.hide())
	}

	async updateComments(file: TAbstractFile) {
		if (!(file instanceof TFile)) return

		const content = await file.vault.cachedRead(file)
		const comments = this.findComments(content)

		this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT).forEach(leaf => {
			if (leaf.view instanceof CommentView) leaf.view.setComments(comments, file.name)
		})

	}

	findComments(file: string): Comment[]{
		const comments: Comment[] = []
		const regex = /> \[!comment\] (.+?)\n((?:> *.*\n?)+)/g;
		const matches = file.matchAll(regex)

		for (const match of matches) {
			const name = match[1].trim()
			const content = match[2].split('\n')
				.map(line => line.replace(/^>/, '').trim())
				.filter(line => line.length > 0)
				.join('\n')


			const startLine = file.slice(0,match.index).match(/\n/g)?.length || 0	
			const endOffset = match.index + match[0].length + 1
			const endLine = file.slice(0, endOffset).match(/\n/g)?.length || 0

			const startPos: EditorPosition = {line: startLine, ch: 0 }
			const endPos: EditorPosition = {line: endLine, ch: 0}
			comments.push({name, content, startPos, endPos})
		}

		return comments
	}
}

class CommentView extends ItemView {
	private comments: AllComments = {};
	private commentsEl: HTMLElement
	private plugin: CommentPlugin

	constructor(leaf: WorkspaceLeaf, plugin: CommentPlugin) {
		super(leaf)
		this.plugin = plugin
	}

	getViewType() {
		return VIEW_TYPE_COMMENT
	}

	getDisplayText() {
		return 'Comment View'
	}

	setComments(comments: Comment[], file: string) {
		this.comments[file] = comments
		this.renderComments(file)
	}

	renderComments(file: string) {
		this.commentsEl.empty()

		this.commentsEl.createEl('h2', { text: 'Comments', cls: 'comments-title' })

		if (this.comments[file].length == 0 ) {
			this.commentsEl.createEl('p', { text: 'No comments found'})
			return
		}

		const commentsList = this.commentsEl.createEl('div', { cls: 'comments-list' });

		this.comments[file].forEach((comment, index) => {
			const commentContainer = commentsList.createEl('div', { 
                cls: 'comment-item-container',
                attr: { 'data-index': index.toString() }
            });

			const commentItem = commentContainer.createEl('div', {
				cls: 'comment-item'
			})

			commentItem.createEl('b', {
				text: `${comment.endPos.line}:`,
				cls: 'comment-line'
			})

            // Comment text
            commentItem.createEl('p', { 
                text: `${comment.content}`, 
                cls: 'comment-text' 
            });
		

			commentItem.createEl('i', {
				text: comment.name,
				cls: 'comment-name'
			})


            // Add click event to navigate to source
            commentItem.addEventListener('click', () => this.navigateToComment(comment, file));
			commentItem.addEventListener('contextmenu', (evt) => this.showCommentOptions(evt, comment, file))
		})
	}

	private async navigateToComment(comment: Comment, fileName: string) {
		await this.app.workspace.openLinkText('', fileName)
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor
		const file = this.app.workspace.getActiveFile()

		if (editor && file && comment.endPos !== undefined) {
			// Convert character position to line and character
			editor.setCursor(comment.endPos);
			const oneBelow = {line: comment.endPos.line + 1, ch: 0}

			editor.scrollIntoView({ from: oneBelow, to: oneBelow }, true);
		}
			
	}

	private showCommentOptions(evt: MouseEvent, comment: Comment, fileName: string) {
		const menu = new Menu()
		menu.addItem(item => {
			item
				.setTitle('Remove')
				.setIcon('trash')
				.onClick(async () => {
					await this.app.workspace.openLinkText('', fileName)
					const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor

					if (editor) {
						editor.replaceRange('', comment.startPos, comment.endPos)
					}
				})
		})

		menu.showAtMouseEvent(evt)
	}

	async onOpen() {
		const container = this.containerEl.children[1]
		container.empty()
		this.commentsEl = container.createEl('div')
		this.commentsEl.createEl('h2', { text: 'Comments', cls: 'comments-title'})
		const activeFile = this.app.workspace.getActiveFile()
		if (activeFile) this.plugin.updateComments(activeFile)
	}

	async onClose() {

	}
}