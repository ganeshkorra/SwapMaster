import { _decorator, Component, Node, Vec3, tween, easing, Sprite, Color, UITransform, Graphics, UIOpacity, Label, Tween, instantiate, SpriteFrame, game } from 'cc';
import { CTAButtonHandler } from './CTAButtonHandler';
import { TutorialController } from './TutorialController';
import { Analytics, analyticsEvents } from './Analytics';
const { ccclass, property } = _decorator;

@ccclass('CategoryElement')
export class CategoryElement {
    @property({ type: Node, tooltip: 'Green label node for this card family. It will show above the column when this family is matched.' })
    public categoryLabelNode: Node | null = null;

    @property({ type: [Node] })
    public items: Node[] = [];
}

@ccclass('GameManager')
export class GameManager extends Component {
    @property(Node)
    public swapCard: Node | null = null;

    @property(Node)
    public fakeCardNode: Node | null = null;

    @property({ type: [CategoryElement] })
    public categoryElements: CategoryElement[] = [];

    private boardColumns: Node[][] = [];
    private categoryLookup: Map<Node, number> = new Map();
    private columnDownArrows: Map<Node[], Node> = new Map();
    private columnRightMarks: Map<Node[], Node> = new Map();
    private completedColumns: Set<Node[]> = new Set();
    private columnMatchMarks: Map<Node[], Node> = new Map();
    private tapHandlersRegistered: Set<Node> = new Set();
    private isSwapping: boolean = false;

    @property({ type: Number })
    public itemsPerColumn: number = 4;

    @property({ type: Number })
    public gameDurationSeconds: number = 45;

    @property(Label)
    public countdownLabel: Label | null = null;

    @property(Label)
    public tutorialGuideLabel: Label | null = null;

    @property({ type: [Node], tooltip: 'Down arrow nodes ordered from left to right below the board columns.' })
    public downArrowNodes: Node[] = [];

    @property({ type: Node, tooltip: 'Back card visual used for the start reveal animation.' })
    public backCardTemplate: Node | null = null;

    @property({ type: Number, tooltip: 'Delay between each column reveal at game start.' })
    public cardRevealColumnDelaySeconds: number = 0.16;

    @property({ type: Number, tooltip: 'Small row stagger inside each revealing column.' })
    public cardRevealRowDelaySeconds: number = 0.035;

    @property(Node)
    public tutorialNode: Node | null = null;

    @property(Node)
    public tutorialTargetNode: Node | null = null;

    @property(Node)
    public tutorialTargetNode2: Node | null = null;

    @property(Node)
    public ctaButtonNode: Node | null = null;

    @property({ type: Number, tooltip: 'Seconds of inactivity before showing the idle hint.' })
    public idleHintDelaySeconds: number = 5;

    @property({ type: Number, tooltip: 'Show the CTA/end screen after this many completed swaps. Set 0 to disable.' })
    public swapsBeforeCta: number = 55;

    @property({ tooltip: 'Hide the native mouse cursor and show an in-game hand cursor instead.' })
    public useCustomHandCursor: boolean = true;

    @property({ type: SpriteFrame, tooltip: 'Optional idle cursor hand. If empty, uses TutorialController idleHandSprite.' })
    public cursorIdleSprite: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: 'Optional click cursor hand. If empty, uses TutorialController clickHandSprite.' })
    public cursorClickSprite: SpriteFrame | null = null;

    @property({ tooltip: 'Browser cursor image used for the idle hand.' })
    public cursorIdleImageUrl: string = 'assets/CTA/CursorIdle.png';

    @property({ tooltip: 'Browser cursor image used for the clicking hand.' })
    public cursorClickImageUrl: string = 'assets/CTA/CursorClick.png';

    @property({ type: Number, tooltip: 'CSS cursor hotspot X, measured from the image left.' })
    public cursorHotspotOffsetX: number = 13;

    @property({ type: Number, tooltip: 'CSS cursor hotspot Y, measured from the image top.' })
    public cursorHotspotOffsetY: number = 3;

    private timerStarted: boolean = false;
    private gameEnded: boolean = false;
    private remainingTime: number = 0;
    private completedSwapCount: number = 0;
    private customCursorPointerDownHandler: ((event: PointerEvent) => void) | null = null;
    private customCursorPointerUpHandler: ((event: PointerEvent) => void) | null = null;
    private cursorIdleCssDataUrl: string = '';
    private cursorClickCssDataUrl: string = '';
    private tutorialGuideVisible: boolean = false;
    private tutorialGuideBaseScale: Vec3 = Vec3.ONE.clone();
    private tutorialController: TutorialController | null = null;
    private tutorialTargetStage: number = 0;
    private tutorialPlayToken: number = 0;
    private lastHandledTapItem: Node | null = null;
    private lastHandledTapTimeMs: number = 0;
    private idleHintActive: boolean = false;
    private idleHintTimer: number = 0;
    private idleHintSourceColumn: Node[] | null = null;
    private idleHintDestinationColumn: Node[] | null = null;
    private idleHintStage: number = 0; // 0 = no hint, 1 = showing source, 2 = showing destination
    private idleHintOriginalScales: Map<Node, Vec3> = new Map();
    
    // Analytics tracking
    private analyticsDisplayedFired: boolean = false;
    private analyticsChallengeStartedFired: boolean = false;
    private analyticsPass25Fired: boolean = false;
    private analyticsPass50Fired: boolean = false;
    private analyticsPass75Fired: boolean = false;
    private analyticsSolvedFired: boolean = false;
    private analyticsFailedFired: boolean = false;
    private analyticsEndcardShownFired: boolean = false;

    start() {
        this.initializeColumns();
        this.buildCategoryLookup();
        this.initializeCategoryLabels();
        this.initializeDownArrows();
        this.setupTapHandlers();
        this.updateMatchedColumns();
        this.remainingTime = this.gameDurationSeconds;
        this.updateCountdownLabel();
        this.hideCtaNode();
        this.setupCustomHandCursor();
        this.playStartCardReveal();
        // Fire DISPLAYED on initial load so analytics records that the playable is ready
        if (!this.analyticsDisplayedFired && Analytics.instance) {
            this.analyticsDisplayedFired = true;
            Analytics.instance.dispatchEvent(analyticsEvents.DISPLAYED);
        }
        this.idleHintTimer = 0;
        this.idleHintActive = false;
        this.idleHintSourceColumn = null;
        this.idleHintDestinationColumn = null;
        this.idleHintStage = 0;
        this.idleHintOriginalScales.clear();
    }

    onDestroy() {
        this.restoreNativeCursor();
        this.unbindCssHandCursorEvents();
    }

    private setupCustomHandCursor() {
        if (!this.useCustomHandCursor) {
            return;
        }

        this.prepareCssHandCursorImages();
        this.setCssHandCursor(false);
        this.bindCssHandCursorEvents();
    }

    private getTutorialController(): TutorialController | null {
        const tutorialRoot = this.tutorialNode || this.node;
        return tutorialRoot.getComponent(TutorialController) || tutorialRoot.getComponentInChildren(TutorialController) || null;
    }

    private hideNativeCursor() {
        const canvas = game.canvas as unknown as { style?: { cursor: string } };
        if (canvas?.style) {
            canvas.style.cursor = 'none';
        }
    }

    private bindCssHandCursorEvents() {
        const canvas = game.canvas as HTMLCanvasElement | null;
        if (!canvas || this.customCursorPointerDownHandler) {
            return;
        }

        this.customCursorPointerDownHandler = () => this.setCssHandCursor(true);
        this.customCursorPointerUpHandler = () => this.setCssHandCursor(false);

        canvas.addEventListener('pointerdown', this.customCursorPointerDownHandler, { passive: true });
        canvas.addEventListener('pointerup', this.customCursorPointerUpHandler, { passive: true });
        canvas.addEventListener('pointercancel', this.customCursorPointerUpHandler, { passive: true });
        canvas.addEventListener('pointerleave', this.customCursorPointerUpHandler, { passive: true });
    }

    private unbindCssHandCursorEvents() {
        const canvas = game.canvas as HTMLCanvasElement | null;
        if (!canvas) {
            return;
        }

        if (this.customCursorPointerDownHandler) {
            canvas.removeEventListener('pointerdown', this.customCursorPointerDownHandler);
        }

        if (this.customCursorPointerUpHandler) {
            canvas.removeEventListener('pointerup', this.customCursorPointerUpHandler);
            canvas.removeEventListener('pointercancel', this.customCursorPointerUpHandler);
            canvas.removeEventListener('pointerleave', this.customCursorPointerUpHandler);
        }

        this.customCursorPointerDownHandler = null;
        this.customCursorPointerUpHandler = null;
    }

    private setCssHandCursor(clicking: boolean) {
        const canvas = game.canvas as unknown as { style?: { cursor: string } };
        if (!canvas?.style) {
            return;
        }

        const imageUrl = clicking
            ? (this.cursorClickCssDataUrl || this.cursorClickImageUrl)
            : (this.cursorIdleCssDataUrl || this.cursorIdleImageUrl);
        canvas.style.cursor = imageUrl
            ? `url("${imageUrl}") ${this.cursorHotspotOffsetX} ${this.cursorHotspotOffsetY}, pointer`
            : 'pointer';
    }

    private prepareCssHandCursorImages() {
        const controller = this.getTutorialController();
        const idleSprite = this.cursorIdleSprite || controller?.idleHandSprite || null;
        const clickSprite = this.cursorClickSprite || controller?.clickHandSprite || null;

        const idleDataUrl = this.tryBuildCursorDataUrlFromSpriteFrame(idleSprite);
        if (idleDataUrl) {
            this.cursorIdleCssDataUrl = idleDataUrl;
            this.setCssHandCursor(false);
        } else {
            this.loadCursorCssDataUrl(this.cursorIdleImageUrl, (dataUrl) => {
                this.cursorIdleCssDataUrl = dataUrl;
                this.setCssHandCursor(false);
            });
        }

        const clickDataUrl = this.tryBuildCursorDataUrlFromSpriteFrame(clickSprite);
        if (clickDataUrl) {
            this.cursorClickCssDataUrl = clickDataUrl;
        } else {
            this.loadCursorCssDataUrl(this.cursorClickImageUrl, (dataUrl) => {
                this.cursorClickCssDataUrl = dataUrl;
            });
        }
    }

    private tryBuildCursorDataUrlFromSpriteFrame(spriteFrame: SpriteFrame | null): string {
        if (!spriteFrame) {
            return '';
        }

        const frame = spriteFrame as unknown as {
            texture?: unknown;
            _texture?: unknown;
        };
        const texture = (frame.texture || frame._texture) as {
            image?: unknown;
            _image?: unknown;
            _mipmaps?: unknown[];
            mipmaps?: unknown[];
            getHtmlElementObj?: () => unknown;
        } | null;

        const source =
            texture?.getHtmlElementObj?.() ||
            texture?.image ||
            texture?._image ||
            texture?._mipmaps?.[0] ||
            texture?.mipmaps?.[0];

        return this.buildCursorDataUrlFromImageSource(source);
    }

    private buildCursorDataUrlFromImageSource(source: unknown): string {
        const asset = source as {
            data?: unknown;
            _nativeAsset?: unknown;
            src?: string;
            width?: number;
            height?: number;
        } | null;

        const imageSource = asset?.data || asset?._nativeAsset || source;
        if (imageSource instanceof HTMLImageElement || imageSource instanceof HTMLCanvasElement) {
            return this.createCursorDataUrl(imageSource);
        }

        return '';
    }

    private createCursorDataUrl(image: HTMLImageElement | HTMLCanvasElement): string {
        const maxSize = 96;
        const scale = Math.min(maxSize / image.width, maxSize / image.height, 1);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
            return '';
        }

        context.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL('image/png');
    }

    private loadCursorCssDataUrl(sourceUrl: string, onLoaded: (dataUrl: string) => void) {
        if (!sourceUrl) {
            return;
        }

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            const dataUrl = this.createCursorDataUrl(image);
            if (dataUrl) {
                onLoaded(dataUrl);
            }
        };
        image.onerror = () => {
            // Keep the current browser cursor fallback if this path is unavailable in a build.
        };
        image.src = sourceUrl;
    }

    private restoreNativeCursor() {
        const canvas = game.canvas as unknown as { style?: { cursor: string } };
        if (canvas?.style) {
            canvas.style.cursor = '';
        }
    }

    private initializeColumns() {
        const allItems = this.getAllItems();
        const tolerance = 40;
        const columns: Array<{ x: number; items: Node[] }> = [];

        allItems.forEach((candidate) => {
            const candidateX = candidate.getWorldPosition(new Vec3()).x;
            let column = columns.find((col) => Math.abs(col.x - candidateX) < tolerance);
            if (!column) {
                column = { x: candidateX, items: [] };
                columns.push(column);
            }
            column.items.push(candidate);
        });

        columns.forEach((column) => {
            column.items.sort((a, b) => {
                const aY = a.getWorldPosition(new Vec3()).y;
                const bY = b.getWorldPosition(new Vec3()).y;
                return bY - aY;
            });
        });

        this.boardColumns = columns.map((column) => column.items);
    }

    private playStartCardReveal() {
        const backTemplate = this.getBackCardTemplate();
        if (!backTemplate || !this.boardColumns.length) {
            this.beginTutorialAfterReveal();
            return;
        }

        backTemplate.active = false;
        this.isSwapping = true;

        const sortedColumns = this.boardColumns
            .slice()
            .sort((a, b) => this.getColumnCenterWorldX(a) - this.getColumnCenterWorldX(b));
        let longestDelay = 0;

        sortedColumns.forEach((column, columnIndex) => {
            column.slice(0, this.itemsPerColumn).forEach((item, rowIndex) => {
                const delay = columnIndex * this.cardRevealColumnDelaySeconds + rowIndex * this.cardRevealRowDelaySeconds;
                longestDelay = Math.max(longestDelay, delay);
                this.prepareAndRevealCard(item, backTemplate, delay);
            });
        });

        this.scheduleOnce(() => {
            this.isSwapping = false;
            this.beginTutorialAfterReveal();
        }, longestDelay + 0.42);
    }

    private getBackCardTemplate(): Node | null {
        if (this.backCardTemplate?.isValid) {
            return this.backCardTemplate;
        }

        return this.findNodeByName(this.node.scene || this.node, 'Back Card');
    }

    private findNodeByName(root: Node, nodeName: string): Node | null {
        if (root.name === nodeName) {
            return root;
        }

        for (const child of root.children) {
            const match = this.findNodeByName(child, nodeName);
            if (match) {
                return match;
            }
        }

        return null;
    }

    private prepareAndRevealCard(item: Node, backTemplate: Node, delay: number) {
        if (!item.parent) {
            return;
        }

        const originalLocalScale = item.getScale().clone();
        const originalWorldScale = item.getWorldScale(new Vec3());
        const itemWorldPosition = item.getWorldPosition(new Vec3());
        const cover = instantiate(backTemplate);
        cover.name = 'RevealBackCard';
        cover.active = true;
        cover.setParent(item.parent);
        cover.setWorldPosition(itemWorldPosition);
        cover.setWorldScale(originalWorldScale);
        cover.setSiblingIndex(item.parent.children.length - 1);

        const itemTransform = item.getComponent(UITransform);
        const coverTransform = cover.getComponent(UITransform);
        if (itemTransform && coverTransform) {
            coverTransform.setContentSize(itemTransform.contentSize.width, itemTransform.contentSize.height);
        }

        item.setScale(new Vec3(0.02, originalLocalScale.y, originalLocalScale.z));

        tween(cover)
            .delay(delay)
            .to(0.16, { scale: new Vec3(0.02, cover.scale.y, cover.scale.z) }, { easing: easing.quadIn })
            .call(() => {
                cover.active = false;
                item.setScale(new Vec3(0.02, originalLocalScale.y, originalLocalScale.z));
                tween(item)
                    .to(0.16, { scale: originalLocalScale }, { easing: easing.quadOut })
                    .call(() => cover.destroy())
                    .start();
            })
            .start();
    }

    private beginTutorialAfterReveal() {
        this.showGuideLabel();
        this.startTutorial();
    }

    private addTapHandler(item: Node) {
        if (this.tapHandlersRegistered.has(item)) {
            return;
        }

        const handler = () => {
            this.onItemTap(item);
        };

        item.on(Node.EventType.TOUCH_END, handler, this);
        item.on(Node.EventType.MOUSE_UP, handler, this);
        this.tapHandlersRegistered.add(item);
    }

    private setupTapHandlers() {
        if (!this.categoryElements.length) {
            return;
        }

        const allItems = this.getAllItems();
        if (!allItems.length) {
            return;
        }

        allItems.forEach((item) => this.addTapHandler(item));

        if (this.swapCard) {
            this.addTapHandler(this.swapCard);
        } else if (this.fakeCardNode && this.fakeCardNode.children.length) {
            this.addTapHandler(this.fakeCardNode.children[0]);
        }
    }

    public onItemTap(tappedItem: Node) {
        if (this.isDuplicateTap(tappedItem)) {
            return;
        }

        this.resetIdleHint();

        if (this.gameEnded || this.isSwapping) {
            return;
        }

        const isFirstTutorialTap = this.tutorialTargetStage === 0 && this.isMatchingTutorialTarget(tappedItem, this.tutorialTargetNode);
        const isSecondTutorialTap = this.tutorialTargetStage === 1 && this.isMatchingTutorialTarget(tappedItem, this.tutorialTargetNode2);

        if (isFirstTutorialTap) {
            this.tutorialTargetStage = 1;
            this.stopTutorial();
        } else if (isSecondTutorialTap) {
            this.tutorialTargetStage = 2;
            this.stopTutorial();
            this.hideGuideLabel();
            this.startGameTimer();
        } else {
            this.tutorialTargetStage = 2;
            this.stopTutorial();
            this.hideGuideLabel();
        }

        // If this is the player's first real interaction (not the first tutorial tap),
        // start the game timer so `CHALLENGE_STARTED` is recorded.
        if (!this.timerStarted && !isFirstTutorialTap && !isSecondTutorialTap) {
            this.startGameTimer();
        }

        if (this.fakeCardNode && tappedItem.parent === this.fakeCardNode) {
            return;
        }

        if (this.swapCard && tappedItem === this.swapCard) {
            return;
        }

        const columnItems = this.boardColumns.find((column) => column.indexOf(tappedItem) !== -1);
        if (!columnItems || columnItems.length < this.itemsPerColumn) {
            return;
        }

        if (this.completedColumns.has(columnItems)) {
            return;
        }

        this.swapColumnBottomWithSwapCard(columnItems);

        if (isFirstTutorialTap) {
            this.scheduleOnce(() => {
                this.startTutorial();
            }, 0.72);
        }
    }

    private isDuplicateTap(tappedItem: Node): boolean {
        const now = Date.now();
        const isDuplicate = this.lastHandledTapItem === tappedItem && now - this.lastHandledTapTimeMs < 120;
        this.lastHandledTapItem = tappedItem;
        this.lastHandledTapTimeMs = now;
        return isDuplicate;
    }

    private isMatchingTutorialTarget(tappedItem: Node, targetNode: Node | null): boolean {
        if (!targetNode?.isValid) {
            return false;
        }

        if (tappedItem === targetNode) {
            return true;
        }

        const targetColumn = this.boardColumns.find((column) => column.indexOf(targetNode) !== -1);
        return !!targetColumn && targetColumn.indexOf(tappedItem) !== -1;
    }

    private resetIdleHint() {
        this.idleHintTimer = 0;
        this.idleHintStage = 0;
        if (this.idleHintActive) {
            this.hideIdleHint();
        }
    }

    private showIdleHint() {
        if (this.idleHintActive || this.gameEnded || this.isSwapping || this.tutorialTargetStage < 2) {
            return;
        }

        const hint = this.getBestIdleHintColumns();
        if (!hint || !hint.source?.length || !hint.destination?.length) {
            return;
        }

        this.idleHintSourceColumn = hint.source;
        this.idleHintDestinationColumn = hint.destination;
        this.idleHintActive = true;
        this.idleHintTimer = 0; // Reset timer for stage transitions
        
        // Check if this is an instant-win (source === destination)
        if (hint.source === hint.destination) {
            // Instant win: just show the destination column, no multi-stage hint needed
            this.idleHintStage = 0; // No transition needed
            this.displayHintColumn(this.idleHintDestinationColumn, false);
        } else {
            // Multi-stage hint: show destination first, then source
            this.idleHintStage = 1; // Start with destination column (the one with 2+ matching cards)
            this.displayHintColumn(this.idleHintDestinationColumn, false);
        }
    }

    private displayHintColumn(column: Node[], isSource: boolean) {
        const items = column.slice(0, this.itemsPerColumn);

        // Animate cards scaling in/out for attention
        items.forEach((item) => {
            Tween.stopAllByTarget(item);
            const baseScale = item.getScale().clone();
            tween(item)
                .repeatForever(
                    tween()
                        .to(0.4, { scale: new Vec3(baseScale.x * 1.01, baseScale.y * 1.01, baseScale.z) }, { easing: easing.quadOut })
                        .to(0.4, { scale: baseScale }, { easing: easing.quadIn })
                )
                .start();
        });

        // Show yellow column highlight
        let markNode = this.getColumnMatchMarkNode(column);
        if (!markNode) {
            markNode = this.createColumnMatchMark(column, items);
        } else {
            // Clean up any previous animation on mark node
            Tween.stopAllByTarget(markNode);
        }
        if (markNode) {
            markNode.active = true;
            this.layoutColumnMatchMark(markNode, items);
            this.drawColumnMatchMark(markNode, new Color(255, 222, 79, 255)); // Bright yellow

            // Pulse the highlight border for attention
            Tween.stopAllByTarget(markNode);
            const baseScale = markNode.getScale().clone();
            tween(markNode)
                .repeatForever(
                    tween()
                        .to(0.4, { scale: new Vec3(baseScale.x * 1.01, baseScale.y * 1.01, baseScale.z) }, { easing: easing.quadOut })
                        .to(0.4, { scale: baseScale }, { easing: easing.quadIn })
                )
                .start();
        }

        // Show hand pointing at the column
        const handPosition = this.getIdleHintHandWorldPosition(column);
        if (handPosition) {
            const tutorialRoot = this.tutorialNode || this.node;
            // Deactivate to reset hand state completely. Stop any existing tutorial
            // animation so tweens don't persist across re-activation.
            const existingController = tutorialRoot?.getComponent(TutorialController) || tutorialRoot?.getComponentInChildren(TutorialController);
                if (existingController) {
                    existingController.stopTutorial();
                    // Place the hand immediately at the target so it doesn't flash at the old position
                    if (typeof existingController.setHandWorldPosition === 'function') {
                        existingController.setHandWorldPosition(handPosition);
                    }
                }

            if (tutorialRoot.active) {
                tutorialRoot.active = false;
                // Small delay to ensure state resets before reactivating
                this.scheduleOnce(() => {
                    const controller = tutorialRoot?.getComponent(TutorialController) || tutorialRoot?.getComponentInChildren(TutorialController);
                    this.tutorialController = controller;
                    if (controller) {
                        tutorialRoot.active = true;
                        controller.playAtWorldPosition(handPosition);
                    }
                }, 0.02);
            } else {
                const controller = existingController || (tutorialRoot?.getComponent(TutorialController) || tutorialRoot?.getComponentInChildren(TutorialController));
                this.tutorialController = controller;
                if (controller) {
                    tutorialRoot.active = true;
                    controller.playAtWorldPosition(handPosition);
                }
            }
        }
    }

    private hideIdleHint() {
        // Stop card scale animations for destination column
        if (this.idleHintDestinationColumn?.length) {
            this.idleHintDestinationColumn.forEach((item) => {
                Tween.stopAllByTarget(item);
                item.setScale(item.getScale()); // Reset to current scale
            });

            const destMarkNode = this.getColumnMatchMarkNode(this.idleHintDestinationColumn);
            if (destMarkNode) {
                Tween.stopAllByTarget(destMarkNode);
                destMarkNode.active = false;
            }
        }

        // Stop card scale animations for source column
        if (this.idleHintSourceColumn?.length) {
            this.idleHintSourceColumn.forEach((item) => {
                Tween.stopAllByTarget(item);
                item.setScale(item.getScale()); // Reset to current scale
            });

            const sourceMarkNode = this.getColumnMatchMarkNode(this.idleHintSourceColumn);
            if (sourceMarkNode) {
                Tween.stopAllByTarget(sourceMarkNode);
                sourceMarkNode.active = false;
            }
        }

        this.idleHintActive = false;
        this.idleHintStage = 0;
        this.idleHintSourceColumn = null;
        this.idleHintDestinationColumn = null;
        this.idleHintOriginalScales.clear();

        if (this.tutorialController) {
            this.tutorialController.stopTutorial();
        }
        if (this.tutorialNode) {
            this.tutorialNode.active = false;
        }
        this.tutorialController = null;
    }

    private getIdleHintHandWorldPosition(column: Node[]): Vec3 | null {
        if (!column.length) {
            return null;
        }

        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        column.forEach((item) => {
            const itemTransform = item.getComponent(UITransform);
            if (!itemTransform) {
                return;
            }

            const bounds = itemTransform.getBoundingBoxToWorld();
            minX = Math.min(minX, bounds.x);
            maxX = Math.max(maxX, bounds.x + bounds.width);
            minY = Math.min(minY, bounds.y);
            maxY = Math.max(maxY, bounds.y + bounds.height);
        });

        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return column[0]?.getWorldPosition(new Vec3()) || null;
        }

        const centerX = (minX + maxX) * 0.5;
        const centerY = (minY + maxY) * 0.5;
        const referencePosition = column[0]?.getWorldPosition(new Vec3()) || new Vec3(centerX, centerY, 0);
        return new Vec3(centerX + 70, centerY - 50, referencePosition.z);
    }

    private getBestIdleHintColumns(): { source: Node[], destination: Node[] } | null {
        // SMART HINT: First check if the swap card can instantly complete a column
        if (this.fakeCardNode && this.fakeCardNode.children.length) {
            const swapCard = this.fakeCardNode.children[0];
            const swapCardCategoryId = this.getCategoryId(swapCard);
            if (swapCardCategoryId !== -1) {

                // Find a column with 2-3 items matching the swap card's category
                // This is an instant-win scenario - tapping this column = guaranteed match
                let instantWinColumn: Node[] | null = null;

                for (let column of this.boardColumns) {
                    if (this.completedColumns.has(column)) {
                        continue;
                    }

                    const items = column.slice(0, this.itemsPerColumn);
                    if (items.length < this.itemsPerColumn) {
                        continue;
                    }

                    // Count how many items match the swap card's category
                    const matchingCount = items.filter((item) => this.getCategoryId(item) === swapCardCategoryId).length;

                    // If this column has 2-3 matching items, it's an instant win
                    if (matchingCount >= 4 && matchingCount < this.itemsPerColumn) {
                        instantWinColumn = column;
                        break; // Found the best hint - stop searching
                    }
                }

                // If we found an instant-win column, return it as the destination
                // The swap card itself is the "source"
                if (instantWinColumn) {
                    return {
                        source: instantWinColumn, // Placeholder (swap card is already in slot)
                        destination: instantWinColumn // The ONLY column to tap for instant win
                    };
                }
            }
        }

        // FALLBACK: If no instant-win found, use the old logic
        // Find the column with the most cards of the same category (destination)
        let bestDestinationColumn: Node[] | null = null;
        let bestCategoryId = -1;
        let bestMatchCount = 0;

        this.boardColumns.forEach((column) => {
            if (this.completedColumns.has(column)) {
                return;
            }

            const items = column.slice(0, this.itemsPerColumn);
            if (items.length < this.itemsPerColumn) {
                return;
            }

            const firstCategoryId = this.getCategoryId(items[0]);
            const matchCount = items.filter((item) => this.getCategoryId(item) === firstCategoryId).length;

            // We want columns with 2-3 matching items (not complete, not empty)
            if (matchCount >= 2 && matchCount < this.itemsPerColumn && matchCount > bestMatchCount) {
                bestMatchCount = matchCount;
                bestDestinationColumn = column;
                bestCategoryId = firstCategoryId;
            }
        });

        // If no good destination found, return null
        if (!bestDestinationColumn || bestCategoryId === -1 || bestMatchCount < 2) {
            return null;
        }

        // Now find another card of the same category in a DIFFERENT column (source - where to tap)
        let sourceColumn: Node[] | null = null;

        for (let column of this.boardColumns) {
            if (column === bestDestinationColumn || this.completedColumns.has(column)) {
                continue;
            }

            const items = column.slice(0, this.itemsPerColumn);
            for (let item of items) {
                if (this.getCategoryId(item) === bestCategoryId) {
                    sourceColumn = column;
                    break;
                }
            }

            if (sourceColumn) {
                break;
            }
        }

        // If we found both source and destination, return them
        if (sourceColumn && bestDestinationColumn) {
            return {
                source: sourceColumn,       // Player taps this FIRST to get the card into swap slot
                destination: bestDestinationColumn // Player taps this SECOND to complete the match
            };
        }

        return null;
    }

    private getAllItems(): Node[] {
        const allItems: Node[] = [];
        this.categoryElements.forEach((category) => {
            category.items.forEach((item) => allItems.push(item));
        });
        return allItems;
    }

    private buildCategoryLookup() {
        this.categoryLookup.clear();
        this.categoryElements.forEach((category, categoryIndex) => {
            category.items.forEach((item) => {
                this.categoryLookup.set(item, categoryIndex);
            });
        });
    }

    private getCategoryId(item: Node): number {
        return this.categoryLookup.get(item) ?? -1;
    }

    private initializeCategoryLabels() {
        this.categoryElements.forEach((category) => {
            if (category.categoryLabelNode) {
                category.categoryLabelNode.active = false;
            }
        });
    }

    private initializeDownArrows() {
        this.columnDownArrows.clear();

        const arrows = this.getDownArrowNodes();
        arrows.forEach((arrow) => {
            arrow.active = true;
        });

        if (!arrows.length || !this.boardColumns.length) {
            return;
        }

        const sortedColumns = this.boardColumns
            .slice()
            .sort((a, b) => this.getColumnCenterWorldX(a) - this.getColumnCenterWorldX(b));

        const sortedArrows = arrows
            .slice()
            .sort((a, b) => a.getWorldPosition(new Vec3()).x - b.getWorldPosition(new Vec3()).x);

        sortedColumns.forEach((column, index) => {
            const arrow = sortedArrows[index];
            if (arrow) {
                this.columnDownArrows.set(column, arrow);
            }
        });
    }

    private getDownArrowNodes(): Node[] {
        if (this.downArrowNodes.length) {
            return this.downArrowNodes.filter((arrow) => !!arrow);
        }

        const arrows: Node[] = [];
        this.collectNodesByName(this.node.scene || this.node, 'Down arrow', arrows);
        return arrows;
    }

    private collectNodesByName(root: Node, nodeName: string, matches: Node[]) {
        if (root.name === nodeName) {
            matches.push(root);
        }

        root.children.forEach((child) => this.collectNodesByName(child, nodeName, matches));
    }

    private hideColumnDownArrow(column: Node[]) {
        const arrow = this.columnDownArrows.get(column);
        if (arrow) {
            arrow.active = false;
        }
    }

    private showColumnRightMark(column: Node[]) {
        const markNode = this.getOrCreateColumnRightMark(column);
        if (!markNode) {
            return;
        }

        Tween.stopAllByTarget(markNode);
        markNode.active = true;
        markNode.setScale(new Vec3(1, 1, 1));
        const opacity = markNode.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 255;
        }

        this.layoutColumnRightMark(markNode, column);
        this.drawColumnRightMark(markNode, new Color(255, 222, 79, 255));
        tween(markNode)
            .to(0.14, { scale: Vec3.ONE }, { easing: easing.quadOut })
            .start();
    }

    private getOrCreateColumnRightMark(column: Node[]): Node | null {
        let markNode = this.columnRightMarks.get(column);
        if (markNode?.isValid) {
            return markNode;
        }

        const arrow = this.columnDownArrows.get(column);
        const parent = arrow?.parent || column[0]?.parent;
        if (!parent) {
            return null;
        }

        markNode = new Node('columnRightMark');
        markNode.addComponent(UITransform).setContentSize(106, 82);
        markNode.addComponent(Graphics);
        markNode.addComponent(UIOpacity);
        markNode.setParent(parent);
        markNode.setSiblingIndex(parent.children.length - 1);
        markNode.active = false;
        this.columnRightMarks.set(column, markNode);
        return markNode;
    }

    private layoutColumnRightMark(markNode: Node, column: Node[]) {
        const parentTransform = markNode.parent?.getComponent(UITransform);
        if (!parentTransform) {
            return;
        }

        const arrow = this.columnDownArrows.get(column);
        if (arrow?.isValid) {
            const arrowWorldPosition = arrow.getWorldPosition(new Vec3());
            markNode.setPosition(parentTransform.convertToNodeSpaceAR(arrowWorldPosition));
            return;
        }

        const items = column.slice(0, this.itemsPerColumn);
        const bounds = this.getColumnWorldBounds(items.length ? items : column);
        if (!bounds) {
            return;
        }

        const centerWorld = new Vec3(
            this.getColumnCenterWorldX(column),
            bounds.minY - 46,
            column[0]?.getWorldPosition(new Vec3()).z || 0
        );
        markNode.setPosition(parentTransform.convertToNodeSpaceAR(centerWorld));
    }

    private drawColumnRightMark(markNode: Node, color: Color) {
        const graphics = markNode.getComponent(Graphics);
        const transform = markNode.getComponent(UITransform);
        if (!graphics || !transform) {
            return;
        }

        const width = transform.contentSize.width;
        const height = transform.contentSize.height;
        graphics.clear();
        graphics.lineWidth = 20;
        graphics.strokeColor = color;
        graphics.moveTo(-width * 0.28, -height * 0.02);
        graphics.lineTo(-width * 0.08, -height * 0.24);
        graphics.lineTo(width * 0.32, height * 0.24);
        graphics.stroke();
    }

    private getColumnCenterWorldX(column: Node[]): number {
        const items = column.slice(0, this.itemsPerColumn);
        const bounds = this.getColumnWorldBounds(items.length ? items : column);
        if (bounds) {
            return (bounds.minX + bounds.maxX) * 0.5;
        }

        return column[0]?.getWorldPosition(new Vec3()).x || 0;
    }

    private displayColumnCategoryLabel(column: Node[], categoryId: number) {
        const labelNode = this.categoryElements[categoryId]?.categoryLabelNode;
        if (!labelNode) {
            return;
        }

        this.moveCategoryLabelToColumn(labelNode, column);
        labelNode.active = true;
    }

    private moveCategoryLabelToColumn(labelNode: Node, column: Node[]) {
        const parentTransform = labelNode.parent?.getComponent(UITransform);
        if (!parentTransform) {
            return;
        }

        const worldPosition = labelNode.getWorldPosition(new Vec3());
        worldPosition.x = this.getColumnCenterWorldX(column);
        const localPosition = parentTransform.convertToNodeSpaceAR(worldPosition);
        labelNode.setPosition(new Vec3(localPosition.x, labelNode.position.y, labelNode.position.z));
    }

    private updateMatchedColumns() {
        this.boardColumns.forEach((column) => {
            const items = column.slice(0, this.itemsPerColumn);
            const bottomItem = column.length ? column[column.length - 1] : null;

            if (!bottomItem) {
                return;
            }

            if (this.completedColumns.has(column)) {
                this.setColumnMatchedVisual(items, true, column, true);
                return;
            }

            if (items.length !== this.itemsPerColumn) {
                this.setColumnMatchedVisual(column, false, column, false);
                return;
            }

            const categoryId = this.getCategoryId(items[0]);
            const matched = categoryId !== -1 && items.every((item) => this.getCategoryId(item) === categoryId);
            if (matched) {
                this.completeColumn(column);
            } else {
                this.setColumnMatchedVisual(items, false, column, false);
            }
        });

        if (!this.gameEnded && this.isAllColumnsCompleted()) {
            this.endGame('win');
        }
    }

    private getHighlightSprites(item: Node): Sprite[] {
        return item.getComponentsInChildren(Sprite);
    }

    private isColumnMatched(columnItems: Node[]): boolean {
        if (columnItems.length < this.itemsPerColumn) {
            return false;
        }
        const categoryId = this.getCategoryId(columnItems[0]);
        return categoryId !== -1 && columnItems.every((item) => this.getCategoryId(item) === categoryId);
    }

    private getColumnMatchMarkNode(column: Node[]): Node | null {
        return this.columnMatchMarks.get(column) || null;
    }

    private createColumnMatchMark(column: Node[], items: Node[]): Node {
        const markNode = new Node('columnMatchMark');
        markNode.addComponent(UITransform);
        markNode.addComponent(Graphics);
        markNode.addComponent(UIOpacity);

        const columnParent = items[0]?.parent || column[0]?.parent;
        if (columnParent) {
            markNode.setParent(columnParent);
            markNode.setSiblingIndex(columnParent.children.length - 1);
        }

        this.layoutColumnMatchMark(markNode, items);
        this.drawColumnMatchMark(markNode, new Color(255, 222, 79, 255));
        markNode.active = false;

        this.columnMatchMarks.set(column, markNode);
        return markNode;
    }

    private getColumnWorldBounds(items: Node[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
        const bounds: ReturnType<UITransform['getBoundingBoxToWorld']>[] = [];
        items.forEach((item) => {
            const transform = item.getComponent(UITransform);
            if (transform) {
                bounds.push(transform.getBoundingBoxToWorld());
            }
        });

        if (!bounds.length) {
            return null;
        }

        const padding = 3;
        return {
            minX: Math.min(...bounds.map((bound) => bound.x)) - padding,
            maxX: Math.max(...bounds.map((bound) => bound.x + bound.width)) + padding,
            minY: Math.min(...bounds.map((bound) => bound.y)) - padding,
            maxY: Math.max(...bounds.map((bound) => bound.y + bound.height)) + padding,
        };
    }

    private completeColumn(column: Node[]) {
        if (this.completedColumns.has(column)) {
            return;
        }
        const items = column.slice(0, this.itemsPerColumn);
        const categoryId = this.getCategoryId(items[0]);
        this.hideColumnDownArrow(column);
        this.showColumnRightMark(column);
        this.setColumnMatchedVisual(items, true, column, false);
        this.scheduleOnce(() => {
            this.displayColumnCategoryLabel(column, categoryId);
        }, 0.22);
        // Add to completed set
        this.completedColumns.add(column);

        // Dispatch progress milestones based on completed columns fraction,
        // but only after the challenge has started (per AppLovin guidance).
        if (this.analyticsChallengeStartedFired) {
            const totalColumns = Math.max(1, this.boardColumns.length);
            const completedCount = this.completedColumns.size;
            const progress = completedCount / totalColumns;

            if (progress >= 0.25 && !this.analyticsPass25Fired && Analytics.instance) {
                this.analyticsPass25Fired = true;
                Analytics.instance.dispatchEvent(analyticsEvents.CHALLENGE_PASS_25);
            }

            if (progress >= 0.5 && !this.analyticsPass50Fired && Analytics.instance) {
                this.analyticsPass50Fired = true;
                Analytics.instance.dispatchEvent(analyticsEvents.CHALLENGE_PASS_50);
            }

            if (progress >= 0.75 && !this.analyticsPass75Fired && Analytics.instance) {
                this.analyticsPass75Fired = true;
                Analytics.instance.dispatchEvent(analyticsEvents.CHALLENGE_PASS_75);
            }
        }

        if (!this.gameEnded && this.completedColumns.size >= 2) {
            this.scheduleOnce(() => {
                this.endGame('win', 0);
            }, 0.45);
        }
    }

    private layoutColumnMatchMark(markNode: Node, items: Node[]) {
        if (!items.length || !items[0].parent) {
            return;
        }

        const parent = items[0].parent;
        markNode.setSiblingIndex(parent.children.length - 1);
        const parentTransform = parent.getComponent(UITransform);
        if (!parentTransform) {
            return;
        }

        const parentScale = parent.getWorldScale(new Vec3());
        const bounds = this.getColumnWorldBounds(items);
        if (!bounds) {
            return;
        }

        const centerWorld = new Vec3((bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5, items[0].getWorldPosition(new Vec3()).z);
        const centerLocal = parentTransform.convertToNodeSpaceAR(centerWorld);
        const localWidth = (bounds.maxX - bounds.minX) / Math.max(parentScale.x, 0.01);
        const localHeight = (bounds.maxY - bounds.minY) / Math.max(parentScale.y, 0.01);

        markNode.setPosition(centerLocal);
        const transform = markNode.getComponent(UITransform);
        if (transform) {
            transform.setContentSize(localWidth, localHeight);
        }
    }

    private drawColumnMatchMark(markNode: Node, color: Color) {
        const graphics = markNode.getComponent(Graphics);
        const transform = markNode.getComponent(UITransform);
        if (!graphics || !transform) {
            return;
        }

        const width = transform.contentSize.width;
        const height = transform.contentSize.height;
        const radius = Math.min(18, width * 0.2, height * 0.08);
        graphics.clear();
        graphics.lineWidth = 4;
        graphics.strokeColor = color;
        graphics.roundRect(-width * 0.5, -height * 0.5, width, height, radius);
        graphics.stroke();
    }

    private playColumnMatchMarkAnimation(markNode: Node) {
        const opacity = markNode.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 255;
        }

        this.drawColumnMatchMark(markNode, new Color(255, 222, 79, 255));
        tween(markNode)
            .delay(0.22)
            .call(() => {
                if (opacity) {
                    opacity.opacity = 255;
                }
            })
            .start();
    }

    private drawStarParticle(particle: Node, color: Color) {
        const graphics = particle.getComponent(Graphics);
        const transform = particle.getComponent(UITransform);
        if (!graphics || !transform) {
            return;
        }

        const outer = Math.min(transform.contentSize.width, transform.contentSize.height) * 0.48;
        const inner = outer * 0.38;
        graphics.clear();
        graphics.fillColor = color;
        graphics.strokeColor = new Color(255, 255, 255, 210);
        graphics.lineWidth = 1.5;
        for (let i = 0; i < 10; i++) {
            const radius = i % 2 === 0 ? outer : inner;
            const angle = Math.PI * 0.2 * i - Math.PI * 0.5;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (i === 0) {
                graphics.moveTo(x, y);
            } else {
                graphics.lineTo(x, y);
            }
        }
        graphics.close();
        graphics.fill();
        graphics.stroke();
    }

    private spawnColumnGlowPulse(parent: Node, parentTransform: UITransform, bounds: { minX: number; maxX: number; minY: number; maxY: number }, z: number) {
        const pulse = new Node('columnSparkPulse');
        const width = bounds.maxX - bounds.minX + 24;
        const height = bounds.maxY - bounds.minY + 24;
        pulse.addComponent(UITransform).setContentSize(width, height);
        pulse.addComponent(Graphics);
        pulse.addComponent(UIOpacity);
        pulse.setParent(parent);
        pulse.setSiblingIndex(parent.children.length - 1);

        const centerWorld = new Vec3((bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5, z);
        pulse.setPosition(parentTransform.convertToNodeSpaceAR(centerWorld));
        pulse.setScale(new Vec3(0.92, 0.92, 1));

        const graphics = pulse.getComponent(Graphics);
        const opacity = pulse.getComponent(UIOpacity);
        if (graphics) {
            const radius = Math.min(24, width * 0.18, height * 0.06);
            graphics.clear();
            graphics.lineWidth = 8;
            graphics.strokeColor = new Color(255, 230, 80, 235);
            graphics.roundRect(-width * 0.5, -height * 0.5, width, height, radius);
            graphics.stroke();
        }
        if (opacity) {
            opacity.opacity = 245;
        }

        tween(pulse)
            .to(0.28, { scale: new Vec3(1.08, 1.08, 1) }, { easing: easing.quadOut })
            .delay(0.04)
            .call(() => pulse.destroy())
            .start();
        if (opacity) {
            tween(opacity)
                .delay(0.08)
                .to(0.24, { opacity: 0 })
                .start();
        }
    }

    private spawnColumnStarParticles(items: Node[]) {
        if (!items.length || !items[0].parent) {
            return;
        }

        const parent = items[0].parent;
        const parentTransform = parent.getComponent(UITransform);
        const bounds = this.getColumnWorldBounds(items);
        if (!parentTransform || !bounds) {
            return;
        }

        const parentScale = parent.getWorldScale(new Vec3());
        const centerX = (bounds.minX + bounds.maxX) * 0.5;
        const centerY = (bounds.minY + bounds.maxY) * 0.5;
        const particleCount = 42;
        const z = items[0].getWorldPosition(new Vec3()).z;
        this.spawnColumnGlowPulse(parent, parentTransform, bounds, z);

        for (let i = 0; i < particleCount; i++) {
            const particle = new Node('columnStarParticle');
            const particleSize = 26 + Math.random() * 20;
            particle.addComponent(UITransform).setContentSize(particleSize, particleSize);
            particle.addComponent(Graphics);
            particle.addComponent(UIOpacity);
            particle.setParent(parent);
            particle.setSiblingIndex(parent.children.length - 1);

            const side = i % 4;
            const fromCenter = i % 3 === 0;
            const edgeX = fromCenter ? centerX : side === 0 ? bounds.minX : side === 1 ? bounds.maxX : bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
            const edgeY = fromCenter ? centerY : side === 2 ? bounds.minY : side === 3 ? bounds.maxY : bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
            const startLocal = parentTransform.convertToNodeSpaceAR(new Vec3(edgeX, edgeY, z));
            const angle = fromCenter ? (Math.PI * 2 * i) / particleCount : Math.atan2(edgeY - centerY, edgeX - centerX);
            const directionX = Math.cos(angle);
            const directionY = Math.sin(angle);
            const drift = 44 + Math.random() * 42;
            const endLocal = new Vec3(
                startLocal.x + directionX * drift / Math.max(parentScale.x, 0.01),
                startLocal.y + directionY * drift / Math.max(parentScale.y, 0.01),
                startLocal.z
            );
            const opacity = particle.getComponent(UIOpacity);
            const scale = 0.7 + Math.random() * 0.55;
            const color = i % 5 === 0
                ? new Color(255, 255, 255, 255)
                : i % 2 === 0
                    ? new Color(255, 241, 96, 255)
                    : new Color(255, 184, 42, 255);

            particle.setPosition(startLocal);
            particle.setScale(new Vec3(0.05, 0.05, 1));
            if (opacity) {
                opacity.opacity = 255;
            }
            this.drawStarParticle(particle, color);

            tween(particle)
                .delay(Math.random() * 0.08)
                .to(0.2, { scale: new Vec3(scale, scale, 1), position: endLocal }, { easing: easing.quadOut })
                .delay(0.12)
                .to(0.2, { scale: new Vec3(0.12, 0.12, 1) }, { easing: easing.quadIn })
                .call(() => particle.destroy())
                .start();
            if (opacity) {
                tween(opacity)
                    .delay(0.2)
                    .to(0.28, { opacity: 0 })
                    .start();
            }
        }
    }

    private setColumnMatchedVisual(items: Node[], matched: boolean, column: Node[], completed: boolean) {
        const highlightColor = matched ? new Color(120, 170, 255, 255) : new Color(255, 255, 255, 255);
        let markNode = this.getColumnMatchMarkNode(column);
        if (!markNode && matched) {
            markNode = this.createColumnMatchMark(column, items);
        }
        if (markNode) {
            markNode.active = matched;
            markNode.setScale(Vec3.ONE);
            if (matched) {
                this.layoutColumnMatchMark(markNode, items);
                if (completed) {
                    const opacity = markNode.getComponent(UIOpacity);
                    if (opacity) {
                        opacity.opacity = 255;
                    }
                    this.drawColumnMatchMark(markNode, new Color(255, 222, 79, 255));
                } else {
                    this.playColumnMatchMarkAnimation(markNode);
                }
            }
        }

        items.forEach((item) => {
            const sprites = this.getHighlightSprites(item);
            if (!matched || completed) {
                sprites.forEach((sprite) => {
                    sprite.color = highlightColor;
                });
            }

            if (matched && !completed) {
                const originalScale = item.getScale();
                const midpoint = originalScale.clone();
                midpoint.x = 0.1;
                if (item === items[0]) {
                    this.spawnColumnStarParticles(items);
                }
                tween(item)
                    .delay(0.08)
                    .to(0.12, { scale: midpoint }, { easing: easing.quadOut })
                    .call(() => {
                        sprites.forEach((sprite) => {
                            sprite.color = highlightColor;
                        });
                    })
                    .to(0.12, { scale: originalScale }, { easing: easing.quadOut })
                    .start();
            }
        });
    }

    public swapColumnBottomWithSwapCard(columnItems: Node[]) {
        if (!this.fakeCardNode) return;
        if (columnItems.length < this.itemsPerColumn) return;
        if (!this.fakeCardNode.children.length) return;
        if (this.isSwapping) return;

        this.isSwapping = true;

        const swapCardItem = this.fakeCardNode.children[0];
        const slotPositions = columnItems.slice(0, this.itemsPerColumn).map((item) => item.getWorldPosition(new Vec3()));
        const bottomItem = columnItems[this.itemsPerColumn - 1];
        const fakeCardWorldPos = this.fakeCardNode.getWorldPosition(new Vec3());
        const columnParent = columnItems[0].parent;

        const bottomItemScale = bottomItem.getWorldScale(new Vec3());
        const swapCardScale = swapCardItem.getWorldScale(new Vec3());

        // Animate the 4th card moving to the fixed fake card slot.
        const bottomTween = tween(bottomItem)
            .to(0.35, { worldPosition: fakeCardWorldPos }, { easing: easing.quadOut });

        bottomTween.call(() => {
            bottomItem.setParent(this.fakeCardNode, true);
            bottomItem.setPosition(Vec3.ZERO);
            bottomItem.setWorldScale(bottomItemScale);
        }).start();

        // Move the swap card out of the fake card slot into the tapped column top slot.
        swapCardItem.setParent(columnParent, true);
        swapCardItem.setWorldScale(swapCardScale);
        this.addTapHandler(swapCardItem);
        tween(swapCardItem)
            .to(0.35, { worldPosition: slotPositions[0] }, { easing: easing.quadOut })
            .start();

        // Move the remaining cards down one by one so the shift is visible.
        for (let i = 0; i < this.itemsPerColumn - 1; i++) {
            tween(columnItems[i])
                .delay(i * 0.05)
                .to(0.35, { worldPosition: slotPositions[i + 1] }, { easing: easing.quadOut })
                .start();
        }

        // Update the board column state for future taps.
        const newColumnItems = [swapCardItem, ...columnItems.slice(0, this.itemsPerColumn - 1)];
        columnItems.length = 0;
        newColumnItems.forEach((item) => columnItems.push(item));

        // Refresh matched visuals after all cards have settled into their final slots.
        this.scheduleOnce(() => {
            this.updateMatchedColumns();
            this.isSwapping = false;
            this.registerCompletedSwap();
        }, 0.62);
    }

    private registerCompletedSwap() {
        if (this.gameEnded || this.swapsBeforeCta <= 0) {
            return;
        }

        this.completedSwapCount++;
        if (this.completedSwapCount >= this.swapsBeforeCta) {
            this.endGame('win', 0);
        }
    }

    private startTutorial() {
        const tutorialRoot = this.tutorialNode || this.node;
        if (!tutorialRoot) {
            return;
        }

        const targetNode = this.getTutorialTargetNode();
        if (!targetNode) {
            return;
        }

        const playToken = ++this.tutorialPlayToken;
        tutorialRoot.active = true;
        this.scheduleOnce(() => {
            if (playToken !== this.tutorialPlayToken || this.tutorialTargetStage >= 2 || this.idleHintActive) {
                return;
            }

            const controller = tutorialRoot.getComponent(TutorialController) || tutorialRoot.getComponentInChildren(TutorialController);
            this.tutorialController = controller;

            if (controller) {
                const handPosition = this.getTutorialHandWorldPosition(targetNode);
                if (handPosition) {
                    controller.playAtWorldPosition(handPosition);
                }
            }
        }, 0.05);
    }

    private getTutorialTargetNode(): Node | null {
        if (this.tutorialTargetStage === 1 && this.tutorialTargetNode2?.isValid) {
            return this.tutorialTargetNode2;
        }

        if (this.tutorialTargetNode?.isValid) {
            return this.tutorialTargetNode;
        }

        if (this.swapCard) {
            return this.swapCard;
        }

        if (this.fakeCardNode && this.fakeCardNode.children.length) {
            return this.fakeCardNode.children[0];
        }

        return this.categoryElements[0]?.items[0] || null;
    }

    private getTutorialHandWorldPosition(targetNode: Node): Vec3 | null {
        if (!targetNode?.isValid) {
            return null;
        }

        const targetUIT = targetNode.getComponent(UITransform);
        const worldPosition = targetNode.getWorldPosition(new Vec3());

        if (targetUIT) {
            const bounds = targetUIT.getBoundingBoxToWorld();
            if (bounds) {
                worldPosition.x = bounds.x + bounds.width * 0.48 + 46;
                worldPosition.y = bounds.y + bounds.height * 0.5 - 58;
            }
        }

        return worldPosition;
    }

    private stopTutorial() {
        this.tutorialPlayToken++;
        if (this.tutorialController) {
            this.tutorialController.stopTutorial();
        }

        if (this.tutorialNode) {
            this.tutorialNode.active = false;
        }

        this.tutorialController = null;
    }

    private showGuideLabel() {
        if (!this.tutorialGuideLabel || this.tutorialGuideVisible) {
            return;
        }

        const guideNode = this.tutorialGuideLabel.node;
        this.tutorialGuideBaseScale = guideNode.getScale().clone();
        this.tutorialGuideVisible = true;
        guideNode.active = true;
        Tween.stopAllByTarget(guideNode);
        guideNode.setScale(this.tutorialGuideBaseScale);

        tween(guideNode)
            .repeatForever(
                tween()
                    .to(0.5, { scale: new Vec3(this.tutorialGuideBaseScale.x * 1.08, this.tutorialGuideBaseScale.y * 1.08, this.tutorialGuideBaseScale.z) }, { easing: easing.quadOut })
                    .to(0.5, { scale: this.tutorialGuideBaseScale }, { easing: easing.quadIn })
            )
            .start();
    }

    private hideGuideLabel() {
        if (!this.tutorialGuideVisible) {
            return;
        }

        this.tutorialGuideVisible = false;
        if (this.tutorialGuideLabel) {
            const guideNode = this.tutorialGuideLabel.node;
            Tween.stopAllByTarget(guideNode);
            guideNode.setScale(this.tutorialGuideBaseScale);
            guideNode.active = false;
        }
    }

    private startGameTimer() {
        if (this.timerStarted || this.gameEnded) {
            return;
        }

        this.timerStarted = true;
        this.remainingTime = this.gameDurationSeconds;
        this.idleHintTimer = 0;
        this.hideIdleHint();
        this.updateCountdownLabel();
        
        // Fire DISPLAYED event when game becomes interactive
        if (!this.analyticsDisplayedFired && Analytics.instance) {
            this.analyticsDisplayedFired = true;
            Analytics.instance.dispatchEvent(analyticsEvents.DISPLAYED);
        }
        
        // Fire CHALLENGE_STARTED event
        if (!this.analyticsChallengeStartedFired && Analytics.instance) {
            this.analyticsChallengeStartedFired = true;
            Analytics.instance.dispatchEvent(analyticsEvents.CHALLENGE_STARTED);
        }
    }

    private updateCountdownLabel() {
        if (!this.countdownLabel) {
            return;
        }

        const totalSeconds = Math.max(0, Math.ceil(this.remainingTime));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const formatTime = (value: number) => (value < 10 ? `0${value}` : `${value}`);
        this.countdownLabel.string = `${formatTime(minutes)}:${formatTime(seconds)}`;
    }

    private isAllColumnsCompleted(): boolean {
        return this.boardColumns.length > 0 && this.boardColumns.every((column) => this.completedColumns.has(column));
    }

    private hideCtaNode() {
        const ctaNode = this.getCtaRootNode();
        if (ctaNode) {
            ctaNode.active = false;
        }
    }

    private getCtaRootNode(): Node | null {
        if (this.ctaButtonNode) {
            return this.ctaButtonNode;
        }

        const handler = this.node.getComponent(CTAButtonHandler) || this.node.getComponentInChildren(CTAButtonHandler);
        return handler ? handler.node : null;
    }

    private getCtaHandler(): CTAButtonHandler | null {
        if (this.ctaButtonNode) {
            return this.ctaButtonNode.getComponent(CTAButtonHandler);
        }

        return this.node.getComponent(CTAButtonHandler) || this.node.getComponentInChildren(CTAButtonHandler) || null;
    }

    private triggerCtaForEndScreen(result: 'win' | 'loss') {
        const ctaHandler = this.getCtaHandler();
        const ctaNode = this.getCtaRootNode();

        if (ctaNode) {
            ctaNode.active = true;
        }

        if (ctaHandler) {
            ctaHandler.onStoreButtonClicked();
        }
    }

    private endGame(result: 'win' | 'loss', ctaDelaySeconds: number = result === 'win' ? 1.5 : 0) {
        if (this.gameEnded) {
            return;
        }

        this.gameEnded = true;
        this.timerStarted = false;
        this.remainingTime = 0;
        this.updateCountdownLabel();

        if (result === 'win') {
            if (!this.analyticsSolvedFired && Analytics.instance) {
                this.analyticsSolvedFired = true;
                Analytics.instance.dispatchEvent(analyticsEvents.CHALLENGE_SOLVED);
            }
        } else {
            if (!this.analyticsFailedFired && Analytics.instance) {
                this.analyticsFailedFired = true;
                Analytics.instance.dispatchEvent(analyticsEvents.CHALLENGE_FAILED);
            }
        }

        if (!this.analyticsEndcardShownFired && Analytics.instance) {
            this.analyticsEndcardShownFired = true;
            Analytics.instance.dispatchEvent(analyticsEvents.ENDCARD_SHOWN);
        }

        // On win, delay showing CTA for a short moment for better UX unless caller requests immediate endscreen.
        if (ctaDelaySeconds > 0) {
            this.scheduleOnce(() => {
                this.triggerCtaForEndScreen(result);
            }, ctaDelaySeconds);
        } else {
            this.triggerCtaForEndScreen(result);
        }
    }

    /**
     * Call this when the player retries a failed challenge (explicit retry flow).
     * This method only reports the AppLovin `CHALLENGE_RETRY` event — it does not
     * perform any game reset logic. Callers should reset game state as needed.
     */
    public reportChallengeRetry() {
        if (Analytics.instance) {
            Analytics.instance.dispatchEvent(analyticsEvents.CHALLENGE_RETRY);
        }
    }

    update(deltaTime: number) {
        if (!this.timerStarted || this.gameEnded || this.isSwapping) {
            return;
        }

        this.remainingTime = Math.max(0, this.remainingTime - deltaTime);
        this.updateCountdownLabel();

        if (this.remainingTime <= 0) {
            this.endGame('loss');
            return;
        }

        // Milestones are reported when columns complete (see completeColumn())

        if (!this.idleHintActive) {
            this.idleHintTimer += deltaTime;
            if (this.idleHintTimer >= this.idleHintDelaySeconds) {
                this.showIdleHint();
            }
        } else if (this.idleHintStage === 1) {
            // Multi-stage hint: After showing destination for 2 seconds, transition to source
            this.idleHintTimer += deltaTime;
            if (this.idleHintTimer >= 2.0) {
                this.transitionToDestinationHint();
            }
        }
        // Stage 0 = instant-win (no transition needed) - just keep showing the same column
        // Stage 2 = showing source column, no further transitions
    }

    private transitionToDestinationHint() {
        if (!this.idleHintSourceColumn?.length || !this.idleHintDestinationColumn?.length) {
            return;
        }

        this.idleHintStage = 2;
        this.idleHintTimer = 0;

        // Stop card scale animations on destination column
        this.idleHintDestinationColumn.forEach((item) => {
            Tween.stopAllByTarget(item);
            item.setScale(item.getScale());
        });

        // Hide destination column highlight
        const destMarkNode = this.getColumnMatchMarkNode(this.idleHintDestinationColumn);
        if (destMarkNode) {
            Tween.stopAllByTarget(destMarkNode);
            destMarkNode.active = false;
        }

        // Stop and fully hide current hand before showing new one
        if (this.tutorialController) {
            this.tutorialController.stopTutorial();
        }

        // Show source column highlight (the one with the card needed)
        this.displayHintColumn(this.idleHintSourceColumn, true);
    }
}
