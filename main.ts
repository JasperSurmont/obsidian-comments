import { debounce, EditorPosition, EventRef, ItemView, MarkdownPostProcessorContext, MarkdownView, Menu, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';

interface Comment {
	name: string
	content: string
	startPos: EditorPosition  // The starting position of the comment
	endPos: EditorPosition	// The end position of the comment
	contentPos: EditorPosition // The position of the content this comment is referring to (same for all subcomments of a comment)
	children: Comment[] // Possible subcomments 
	file: TFile
	timestamp: Date | undefined
	childrenHidden?: boolean // Whether the children are hidden in the sidebar or not
}

interface AllComments {
	[key: string]: Comment[]
}

const VIEW_TYPE_COMMENT = 'comment-view'

export default class CommentPlugin extends Plugin {
	debounceUpdate = debounce(this.updateComments, 500, true)
	mdView: MarkdownView
	modifyListener: EventRef
	fileOpenListener: EventRef

	async onload() {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!mdView) {
			console.error("Could not get active markdown view when setting up plugin")
			return
		}

		this.registerMarkdownPostProcessor(this.postProcessor.bind(this))

		this.mdView = mdView
		this.addRibbonIcon('message-circle', 'Comments', () => {
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
			if (file) this.updateComments(file)
		}
		)

		this.addCommand({
			id: 'add',
			name: 'Add comment at the current cursor position',
			editorCallback(editor) {
				editor.replaceRange(`> [!comment] NAME | ${new Date().toLocaleDateString()}\n> COMMENT`, editor.getCursor('from'), editor.getCursor('to'))
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
			
			await leaf.setViewState({ type: VIEW_TYPE_COMMENT, active: true});
		}

		workspace.revealLeaf(leaf);
	}

	onunload() {
		this.app.workspace.offref(this.modifyListener)
		this.app.workspace.offref(this.fileOpenListener)
	}

	postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		if (this.mdView.getMode() == 'source') return;
		let callouts = el.findAll(".callout").filter(c => c.getAttribute('data-callout')?.toLowerCase() === 'comment')
		callouts.forEach(c => {
			c.hide()
		})
	}

	async updateComments(file: TAbstractFile) {
		if (!(file instanceof TFile)) return

		const content = await file.vault.cachedRead(file)
		const comments = this.findComments(file, content, { line: 0, ch: 0 })

		this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENT).forEach(leaf => {
			if (leaf.view instanceof CommentView) leaf.view.setComments(comments, file.name)
		})

	}

	// Find all comments in the given file
	//
	// @param fileContent: the content to check as a string (can be whole file or content of a comment)
	// @param posOffset: the offset (in amount of lines) of the current content (used in subomments)
	// @param parentContentPos: the content position, useful in subcomments such that they refer to the correct position
	findComments(file: TFile, fileContent: string, posOffset: EditorPosition, parentContentPos?: EditorPosition): Comment[] {
		const comments: Comment[] = []
		const regex = /> \[!comment\] (.+?)\n((?:> *.*\n?)+)/gi;
		const matches = fileContent.matchAll(regex)

		for (const match of matches) {
			// match[0] is the matched content, 1 is the first capture group, 2 is the second capture group, etc.
			let name = match[1].trim()
			let timestamp
			let contentPos: EditorPosition
		
			if (!match.index) {
				// shouldn't happen, but TS compiler errors over this
				continue;
			}

			if (name.indexOf('| ') >= 0) {
				// Don't split on separators to allow users to use different separators
				const date = name.slice(name.indexOf("| ") + 2)
				const day = parseInt(date.slice(0, 2))
				const month = parseInt(date.slice(3, 5))
				const year = parseInt(date.slice(6))
				timestamp = new Date(year, month - 1, day)
				name = name.slice(0, name.indexOf('| '))
			}

			// Original full content, including subcomments
			let content = match[2].split('\n')
				.map(line => line.replace(/^>/, '').trim())
				.join('\n')

			// Start line: amount of line breaks plus 1
			const startLine = (fileContent.slice(0, match.index).match(/\n/g)?.length || -1) + 1
			// End line: amount of line breaks, but we add 1 because the next line is always empty
			// (otherwise, the comment would still continue on this line)
			const endLine = (fileContent.slice(0, match.index + match[0].length).match(/\n/g)?.length || -1) + 1
			const startPos = { line: startLine + posOffset.line, ch: 0 }
			const endPos = { line: endLine + posOffset.line, ch: 0 }

			if (!parentContentPos) contentPos = { line: endPos.line, ch: 0 }
			else contentPos = parentContentPos

			// We need to add one to the line cause we are not counting the title (name) line
			const children = this.findComments(file, content, { line: startPos.line, ch: 0 }, contentPos)

			// We want this comment not to have the subcomments as content
			if (content.indexOf('>') >= 0)
				content = content.slice(0, content.indexOf('>'))

			comments.push({ name, content, startPos, endPos, children, contentPos, file, timestamp, childrenHidden: true })
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

	getIcon(): string {
		return 'message-circle'
	}

	getViewType() {
		return VIEW_TYPE_COMMENT
	}

	getDisplayText() {
		return 'Comment view'
	}

	setComments(comments: Comment[], fileName: string) {
		this.comments[fileName]?.forEach(prevComment => {
			const i = comments.findIndex(newComment => {
				prevComment.startPos === newComment.startPos &&
					prevComment.content === newComment.content
			})
			if (i >= 0) comments[i].childrenHidden = prevComment.childrenHidden
		})

		this.comments[fileName] = comments
		this.renderComments(fileName)
	}

	renderComments(fileName: string) {
		this.commentsEl.empty()

		this.comments[fileName].forEach((comment, index) => {
			const commentContainer = this.commentsEl.createEl('div', {
				cls: 'comment-item-container',
			});

			const headerDiv = commentContainer.createEl('div', { cls: 'comment-header' })
			headerDiv.createEl('b', {
				text: `Line ${comment.endPos.line}`,
				cls: 'comment-line'
			})
			const minimizeEl = headerDiv.createEl('button', {
				text: '+',
				cls: 'comment-minimize',
			})


			headerDiv.createEl('b', {
				cls: 'comment-item-date',
				text: comment.timestamp?.toLocaleDateString()
			})

			const commentItem = commentContainer.createEl('div', {
				cls: 'comment-item'
			})

			// Comment text
			commentItem.createEl('p', {
				text: `${comment.content}`,
				cls: 'comment-item-text'
			});


			commentItem.createEl('i', {
				text: comment.name,
				cls: 'comment-name'
			})

			if (comment.children.length > 0) {
				const childrenCommentsEl = commentContainer.createEl('div', { cls: 'comment-children'})
				// Initially hide the children
				hideChildren(childrenCommentsEl)

				// Recursively render the comments
				this.renderChildrenComments(comment.children, fileName, childrenCommentsEl)

				// Minize the comment listener
				minimizeEl?.addEventListener('click', () => {
					if (isHidden(childrenCommentsEl)) {
						showChildren(childrenCommentsEl)
						minimizeEl!.innerText = '-'
					} else {
						hideChildren(childrenCommentsEl)
						minimizeEl!.innerText = '+'
					}
				})
			} else {
				minimizeEl.hide()
				minimizeEl.setAttr('hidden', true)
			}


			// Add click event to navigate to source
			commentItem.addEventListener('click', () => this.navigateToComment(comment, fileName));
			commentItem.addEventListener('contextmenu', (evt) => this.showCommentOptions(evt, comment, false))
		})
	}

	renderChildrenComments(comments: Comment[], fileName: string, element: HTMLElement) {
		element.empty()

		comments.forEach(comment => {
			const commentContainer = element.createEl('div', {
				cls: 'comment-child-container'
			});

			commentContainer.createEl('div', { cls: 'comment-child-separator' })

			const headerDiv = commentContainer.createEl('div', { cls: 'comment-header' })
			// Empty div to retain layout
			headerDiv.createEl('div')

			headerDiv.createEl('b', {
				cls: 'comment-child-date',
				text: comment.timestamp ? comment.timestamp.toLocaleDateString() : '',
			})

			const commentItem = commentContainer.createEl('div', {
				cls: 'comment-child'
			})

			// Comment text
			commentItem.createEl('p', {
				text: `${comment.content}`,
				cls: 'comment-child-text'
			});


			commentItem.createEl('i', {
				text: comment.name,
				cls: 'comment-name'
			})

			// Add click event to navigate to source
			commentItem.addEventListener('click', () => this.navigateToComment(comment, fileName));
			commentItem.addEventListener('contextmenu', (evt) => this.showCommentOptions(evt, comment, true))
		})
	}

	private async navigateToComment(comment: Comment, fileName: string) {
		await this.app.workspace.openLinkText('', fileName)
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor
		const file = this.app.workspace.getActiveFile()

		if (editor && file) {
			// Convert character position to line and character
			editor.setCursor(comment.contentPos);

			editor.scrollIntoView({ from: comment.contentPos, to: comment.contentPos }, true);
		}

	}

	private showCommentOptions(evt: MouseEvent, comment: Comment, child: boolean) {
		const menu = new Menu()
		let addTitle = "Add subcomment"
		let removeTitle = "Remove entire comment"

		if (child) {
			addTitle = "Add follow-up subcomment"
			removeTitle = "Remove subcomment"
		}

		menu.addItem(item => {
			item
				.setTitle(addTitle)
				.setIcon("plus")
				.onClick(() => this.addComment(comment))
		})

		menu.addItem(item => {
			item
				.setTitle(removeTitle)
				.setIcon('trash')
				.onClick(() => this.removeComment(comment))
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

	private async removeComment(comment: Comment) {
		this.app.vault.process(comment.file, content => {
			const lines = content.split('\n')
			// Start from -1 because Obsidian lines are 1-indexed, and code is 0-indexed
			lines.splice(comment.startPos.line - 1, comment.endPos.line - comment.startPos.line)
			content = lines.join('\n')
			return content
		})

		this.comments[comment.file.name].remove(comment)
		this.renderComments(comment.file.name)
	}

	async onOpen() {
		const container = this.containerEl.children[1]
		container.empty()
		const commentContainer = container.createEl('div')
		commentContainer.createEl('h2', { text: 'Comments', cls: 'comments-title' })
		this.commentsEl = commentContainer.createEl('div')

		const activeFile = this.app.workspace.getActiveFile()
		if (activeFile) this.plugin.updateComments(activeFile)
	}

	async onClose() {

	}
}

function hideChildren(children: HTMLDivElement) {
	children.addClass('hidden')
}

function showChildren(children: HTMLDivElement) {
	children.removeClass('hidden')
}

function isHidden(children: HTMLDivElement) {
	return children.classList.contains('hidden')
}