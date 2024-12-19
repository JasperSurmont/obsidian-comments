import { App, debounce, Debouncer, Editor, EditorPosition, EventRef, Events, ItemView, MarkdownPostProcessorContext, MarkdownView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile, Vault, WorkspaceLeaf } from 'obsidian';

interface Comment {
	name: string
	content: string
	startPos: EditorPosition
	endPos: EditorPosition
	contentPos: EditorPosition
	children: Comment[]
	file: TFile
	timestamp?: Date
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
				editor.replaceRange(`> [!comment] NAME | ${new Date().toLocaleDateString()}\n> COMMENT`, editor.getCursor())
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
		const comments = this.findComments(file, content, {line: 0, ch: 0})

		this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT).forEach(leaf => {
			if (leaf.view instanceof CommentView) leaf.view.setComments(comments, file.name)
		})

	}

	findComments(file: TFile, fileContent: string, posOffset: EditorPosition, contentPos?: EditorPosition): Comment[] {
		const comments: Comment[] = []
		const regex = /> \[!comment\] (.+?)\n((?:> *.*\n?)+)/gi;
		const matches = fileContent.matchAll(regex)

		for (const match of matches) {
			let name = match[1].trim()
			let timestamp

			if (name.indexOf('| ') >= 0) {
				const [day,month,year] = name.slice(name.indexOf("| ") + 2).split('/').map(Number)
				timestamp = new Date(year, month - 1, day)
				name = name.slice(0, name.indexOf('| '))
			}

			// Original full content, including subcomments
			let content = match[2].split('\n')
				.map(line => line.replace(/^>/, '').trim())
				.join('\n')
			

			const startLine = fileContent.slice(0,match.index).match(/\n/g)?.length || 0
			const endLine = fileContent.slice(0, match.index + match[0].length + 1).match(/\n/g)?.length || 0
			const startPos = {line: startLine + posOffset.line, ch: 0 }
			const endPos = {line: endLine + posOffset.line, ch: 0}

			if (!contentPos) contentPos = {line: endPos.line, ch: 0}

			// We need to add one to the line cause we are not counting the title (name) line
			const children = this.findComments(file, content, {line: startPos.line + 1, ch: 0}, contentPos)

			// We want this comment not to have the subcomments as content
			if (content.indexOf('>') >= 0)
				content = content.slice(0, content.indexOf('>'))

			comments.push({name, content, startPos, endPos, children, contentPos, file, timestamp })
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
		console.log(comments)
		this.renderComments(this.comments[file], file, this.commentsEl)
	}

	renderComments(comments: Comment[], fileName: string, element: HTMLElement, nested?: boolean) {
		element.empty()

		comments.forEach((comment, index) => {
			const commentContainer = element.createEl('div', { 
                cls: 'comment-item-container',
                attr: { 'data-index': index.toString() }
            });

			const headerDiv = commentContainer.createEl('div', {cls: 'comment-item-header'})
			const dateClasses = ['comment-item-date']
			if (!nested) {
				headerDiv.createEl('b', {
					text: `Line ${comment.endPos.line}`,
					cls: 'comment-line'
				})
			} else {
				// Create empty div to retain layout
				headerDiv.createEl('div')
				dateClasses.push('comment-item-date-nested')
			}

			headerDiv.createEl('b', {
				cls: dateClasses, 
				text: comment.timestamp?.toLocaleDateString()
			})

			const commentItem = commentContainer.createEl('div', {
				cls: 'comment-item'
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

			if (comment.children.length > 0) {
				const childrenCommentsEl = commentContainer.createEl('div', { cls: 'comment-children' })
				this.renderComments(comment.children, fileName, childrenCommentsEl, true)
			}


            // Add click event to navigate to source
			commentContainer.addEventListener('click', () => this.navigateToComment(comment, fileName));
			commentContainer.addEventListener('contextmenu', (evt) => this.showCommentOptions(evt, comment, fileName))
		})
	}

	private async navigateToComment(comment: Comment, fileName: string) {
		await this.app.workspace.openLinkText('', fileName)
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor
		const file = this.app.workspace.getActiveFile()

		console.log(`start: ${comment.contentPos.line}`)

		if (editor && file ) {
			// Convert character position to line and character
			editor.setCursor(comment.contentPos);

			editor.scrollIntoView({ from: comment.contentPos, to: comment.contentPos }, true);
		}
			
	}

	private showCommentOptions(evt: MouseEvent, comment: Comment, fileName: string) {
		const menu = new Menu()

		menu.addItem(item => {
			item
				.setTitle("Add")
				.setIcon("plus")
				.onClick(() => this.addComment(comment))
		})

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

	private addComment(comment: Comment) {
		this.app.vault.process(comment.file, content => {
			const lines = content.split('\n')
			lines.splice(comment.endPos.line - 1, 0, "> ", `>> [!comment] NAME | ${new Date().toLocaleDateString()}`, ">> COMMENT")
			content = lines.join('\n')
			return content
		})
	}

	async onOpen() {
		const container = this.containerEl.children[1]
		container.empty()
		const commentContainer = container.createEl('div')
		commentContainer.createEl('h2', { text: 'Comments', cls: 'comments-title'})
		this.commentsEl = commentContainer.createEl('div')

		const activeFile = this.app.workspace.getActiveFile()
		if (activeFile) this.plugin.updateComments(activeFile)
	}

	async onClose() {

	}
}