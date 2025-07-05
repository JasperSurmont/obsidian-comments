import { App, debounce, EditorPosition, EventRef, ItemView, MarkdownPostProcessorContext, MarkdownView, Menu, Plugin, TAbstractFile, TFile, WorkspaceLeaf, PluginSettingTab, Setting, moment } from 'obsidian';

interface CommentPluginSettings {
	username: string;
}

const DEFAULT_SETTINGS: CommentPluginSettings = {
	username: 'User'
}

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
	settings: CommentPluginSettings;
	deounceUpdate = debounce(this.updateComments, 500, true)
	modifyListener: EventRef
	fileOpenListener: EventRef

	public getFormattedDate(): string {
		// Get the daily notes plugin settings
		const dailyNotesPlugin = (this.app as any).internalPlugins?.plugins?.['daily-notes'];
		const dailyNotesSettings = dailyNotesPlugin?.instance?.options;
		
		// Use the format from daily notes settings, fallback to YYYY-MM-DD if not available
		const format = dailyNotesSettings?.format || 'YYYY-MM-DD';
		
		// Use moment to format the current date
		return moment().format(format);
	}

	public getFormattedTimestamp(): string {
		// Get the daily notes plugin settings for date format
		const dailyNotesPlugin = (this.app as any).internalPlugins?.plugins?.['daily-notes'];
		const dailyNotesSettings = dailyNotesPlugin?.instance?.options;
		const dateFormat = dailyNotesSettings?.format || 'YYYY-MM-DD';
		
		const now = moment();
		const dateLink = `[[${now.format(dateFormat)}]]`;
		const timeStamp = now.format('HH:mm');
		
		// Return format: [[2025-07-05]] 14:30
		return `${dateLink} ${timeStamp}`;
	}

	async onload() {
		await this.loadSettings();
		
		this.addSettingTab(new SettingTab(this.app, this));

		this.registerMarkdownPostProcessor(this.postProcessor.bind(this))
		this.addRibbonIcon('message-circle', 'Comments', () => {
			this.activateView();
		});

		this.registerView(
			VIEW_TYPE_COMMENT,
			(leaf) => new CommentView(leaf, this)
		)

		this.modifyListener = this.app.vault.on('modify', file => {
			this.deounceUpdate(file)
		})

		this.fileOpenListener = this.app.workspace.on('file-open', file => {
			if (file) this.updateComments(file)
		}
		)

		this.addCommand({
			id: 'add',
			name: 'Add comment at the current cursor position',
			editorCallback: (editor) => {
				if (!editor) {
					console.error("No active editor found");
					return;
				}
				const startPos = editor.getCursor('from');
				const endPos = editor.getCursor('to');
				
				// Insert the comment template
				editor.replaceRange(`> [!comment] ${this.settings.username} | ${this.getFormattedTimestamp()}\n> `, startPos, endPos);
				
				// Position cursor at the end of the content line (after "> ")
				const newCursorPos = { line: startPos.line + 1, ch: 2 };
				editor.setCursor(newCursorPos);
			},
		})

		// Load settings
		await this.loadSettings();
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
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView || mdView.getMode() == 'source') return;
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
				// Extract the timestamp part after the pipe
				const timestampStr = name.slice(name.indexOf("| ") + 2).trim()
				
				// Handle the new format: [[YYYY-MM-DD]] HH:mm
				if (timestampStr.includes('[[') && timestampStr.includes(']]')) {
					// Extract date from wiki-link format [[YYYY-MM-DD]]
					const dateMatch = timestampStr.match(/\[\[(\d{4}-\d{2}-\d{2})\]\]/)
					if (dateMatch) {
						const datePart = dateMatch[1] // YYYY-MM-DD
						const [year, month, day] = datePart.split('-').map(Number)
						
						// Check if there's a time part
						const timeMatch = timestampStr.match(/\]\]\s+(\d{2}):(\d{2})/)
						if (timeMatch) {
							const [, hours, minutes] = timeMatch
							timestamp = new Date(year, month - 1, day, parseInt(hours), parseInt(minutes))
						} else {
							timestamp = new Date(year, month - 1, day)
						}
					}
				} else {
					// Handle legacy format: DD/MM/YYYY
					const dateParts = timestampStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
					if (dateParts) {
						const [, day, month, year] = dateParts
						timestamp = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
					}
				}
				
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

			comments.push({ name, content, startPos, endPos, children, contentPos, file, timestamp, childrenHidden: false })
		}

		return comments
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: CommentPlugin;

	constructor(app: App, plugin: CommentPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Username')
			.setDesc('The name that will appear on your comments')
			.addText(text => text
				.setPlaceholder('Enter your username')
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}));
	}
}

class CommentView extends ItemView {
	private comments: AllComments = {};
	private commentsEl: HTMLElement
	private plugin: CommentPlugin
	private expandAllButton: HTMLElement

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
		// If we have previous comments, try to preserve their childrenHidden state
		if (this.comments[fileName]) {
			this.comments[fileName].forEach(prevComment => {
				// Try to find a matching comment by content and name first (more reliable than position)
				const i = comments.findIndex(newComment => {
					return prevComment.content === newComment.content &&
						prevComment.name === newComment.name &&
						prevComment.children.length === newComment.children.length
				})
				if (i >= 0) {
					comments[i].childrenHidden = prevComment.childrenHidden
				}
			})
		}

		this.comments[fileName] = comments
		this.renderComments(fileName)
	}

	renderComments(fileName: string) {
		this.commentsEl.empty()

		// Update expand all button text based on current state
		this.updateExpandAllButton(fileName)

		this.comments[fileName].forEach((comment, index) => {
			const commentContainer = this.commentsEl.createEl('div', {
				cls: 'comment-item-container',
			});

			const headerDiv = commentContainer.createEl('div', { cls: 'comment-header' })
			
			// Left side: Line number
			headerDiv.createEl('b', {
				text: `Line ${comment.endPos.line}`,
				cls: 'comment-line'
			})
			
			// Center: Author name and date/time
			const metaDiv = headerDiv.createEl('div', { cls: 'comment-meta' })
			metaDiv.createEl('span', {
				text: comment.name,
				cls: 'comment-author'
			})
			
			const datetimeDiv = metaDiv.createEl('div', { cls: 'comment-datetime' })
			if (comment.timestamp) {
				datetimeDiv.createEl('span', {
					text: comment.timestamp.toLocaleDateString(),
					cls: 'comment-item-date'
				})
				datetimeDiv.createEl('span', {
					text: comment.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
					cls: 'comment-item-time'
				})
			}
			
			// Right side: Minimize button
			const minimizeEl = headerDiv.createEl('button', {
				text: '+',
				cls: 'comment-minimize',
			})

			const commentItem = commentContainer.createEl('div', {
				cls: 'comment-item'
			})

			// Comment text
			commentItem.createEl('p', {
				text: `${comment.content}`,
				cls: 'comment-item-text'
			});

			if (comment.children.length > 0) {
				const childrenCommentsEl = commentContainer.createEl('div', { cls: 'comment-children'})
				
				// Set initial visibility based on the comment's childrenHidden state
				if (comment.childrenHidden) {
					hideChildren(childrenCommentsEl)
					minimizeEl!.innerText = '+'
				} else {
					showChildren(childrenCommentsEl)
					minimizeEl!.innerText = '-'
				}

				// Recursively render the comments
				this.renderChildrenComments(comment.children, fileName, childrenCommentsEl)

				// Minize the comment listener
				minimizeEl?.addEventListener('click', () => {
					if (isHidden(childrenCommentsEl)) {
						showChildren(childrenCommentsEl)
						minimizeEl!.innerText = '-'
						comment.childrenHidden = false
					} else {
						hideChildren(childrenCommentsEl)
						minimizeEl!.innerText = '+'
						comment.childrenHidden = true
					}
					// Update expand all button when individual comments are toggled
					this.updateExpandAllButton(fileName)
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
			// Left side: Empty div to maintain layout
			headerDiv.createEl('div')

			// Center: Author name and date/time
			const metaDiv = headerDiv.createEl('div', { cls: 'comment-child-meta' })
			metaDiv.createEl('span', {
				text: comment.name,
				cls: 'comment-child-author'
			})
			
			const datetimeDiv = metaDiv.createEl('div', { cls: 'comment-datetime' })
			if (comment.timestamp) {
				datetimeDiv.createEl('span', {
					text: comment.timestamp.toLocaleDateString(),
					cls: 'comment-child-date'
				})
				datetimeDiv.createEl('span', {
					text: comment.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
					cls: 'comment-child-time'
				})
			}
			
			// Right side: Empty div to maintain layout
			headerDiv.createEl('div')

			const commentItem = commentContainer.createEl('div', {
				cls: 'comment-child'
			})

			// Comment text
			commentItem.createEl('p', {
				text: `${comment.content}`,
				cls: 'comment-child-text'
			});

			// Add click event to navigate to source
			commentItem.addEventListener('click', () => this.navigateToComment(comment, fileName));
			commentItem.addEventListener('contextmenu', (evt) => this.showCommentOptions(evt, comment, true))
		})
	}

	private updateExpandAllButton(fileName: string) {
		if (!this.expandAllButton || !this.comments[fileName]) return
		
		// Check if all comments with children are expanded
		const commentsWithChildren = this.comments[fileName].filter(comment => comment.children.length > 0)
		const allExpanded = commentsWithChildren.every(comment => !comment.childrenHidden)
		
		this.expandAllButton.textContent = allExpanded ? 'Collapse All' : 'Expand All'
	}

	private toggleExpandAll(fileName: string) {
		if (!this.comments[fileName]) return
		
		// Check current state - if any comment is collapsed, expand all; otherwise collapse all
		const commentsWithChildren = this.comments[fileName].filter(comment => comment.children.length > 0)
		const anyCollapsed = commentsWithChildren.some(comment => comment.childrenHidden)
		
		// Set all comments to the opposite state
		commentsWithChildren.forEach(comment => {
			comment.childrenHidden = anyCollapsed ? false : true
		})
		
		// Re-render the comments to apply the changes
		this.renderComments(fileName)
	}

	private async navigateToComment(comment: Comment, fileName: string) {
		await this.app.workspace.openLinkText('', fileName)
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor
		const file = this.app.workspace.getActiveFile()

		if (editor && file) {
			// Navigate to the end of the first line of the specific comment
			const line = editor.getLine(comment.startPos.line);
			const endOfLinePos = { line: comment.startPos.line, ch: line.length };
			editor.setCursor(endOfLinePos);

			editor.scrollIntoView({ from: endOfLinePos, to: endOfLinePos }, true);
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

	private async addComment(comment: Comment) {
		let newCommentLine = 0;
		
		await this.app.vault.process(comment.file, content => {
			const lines = content.split('\n')
			let insertPosition = comment.endPos.line - 2
			if (insertPosition < comment.startPos.line) {
				insertPosition = comment.startPos.line
			}
			// Insert the subcomment lines
			lines.splice(insertPosition + 1, 0, "> ")
			lines.splice(insertPosition + 2, 0, `>> [!comment] ${this.plugin.settings.username} | ${this.plugin.getFormattedTimestamp()}`)
			lines.splice(insertPosition + 3, 0, ">> ")
			
			// Store the line number where the comment content should be (1-based)
			// The content line is at insertPosition + 3 (0-based), so +1 for 1-based = insertPosition + 4
			newCommentLine = insertPosition + 4;
			
			return lines.join('\n')
		})

		// Add a small delay to ensure the file is saved and updated
		setTimeout(async () => {
			await this.navigateToNewComment(comment.file, newCommentLine);
		}, 100);
	}

	private async navigateToNewComment(file: TFile, lineNumber: number) {
		// Open the file
		await this.app.workspace.openLinkText('', file.name);
		
		// Add a small delay to ensure the editor is ready
		setTimeout(() => {
			// Get the active editor
			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			
			if (editor) {
				// Position cursor at the end of the comment content line (after ">> ")
				const cursorPos = { line: lineNumber - 1, ch: 3 }; // -1 for 0-based indexing, ch: 3 for after ">> "
				editor.setCursor(cursorPos);
				
				// Scroll to make sure the cursor is visible
				editor.scrollIntoView({ from: cursorPos, to: cursorPos }, true);
				
				// Focus the editor
				editor.focus();
			}
		}, 200);
	}

	private async removeComment(comment: Comment) {
		this.app.vault.process(comment.file, content => {
			const lines = content.split('\n')
			// Start from -1 because Obsidian lines are 1-indexed, and code is 0-indexed
			lines.splice(comment.startPos.line - 1, comment.endPos.line - comment.startPos.line)
			content = lines.join('\n')
			return content
		})

		// Remove the comment from our local state and re-render
		// The setComments method will be called by the file modification listener
		// which will preserve the childrenHidden state of remaining comments
	}

	async onOpen() {
		const container = this.containerEl.children[1]
		container.empty()
		const commentContainer = container.createEl('div')
		
		// Header with title and expand all button
		const headerContainer = commentContainer.createEl('div', { 
			cls: 'comments-header-container',
			attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;' }
		})
		headerContainer.createEl('h2', { text: 'Comments', cls: 'comments-title' })
		
		this.expandAllButton = headerContainer.createEl('button', {
			text: 'Expand All',
			cls: 'expand-all-button',
			attr: { 
				style: 'padding: 4px 8px; font-size: 12px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); border-radius: 3px; cursor: pointer;'
			}
		})
		
		this.expandAllButton.addEventListener('click', () => {
			const activeFile = this.app.workspace.getActiveFile()
			if (activeFile) {
				this.toggleExpandAll(activeFile.name)
			}
		})
		
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