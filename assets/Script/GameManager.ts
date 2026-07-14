import { _decorator, Component, Node, Vec3, tween, easing, Sprite, Color, UITransform, Graphics, UIOpacity, Label, Tween } from 'cc';
import { CTAButtonHandler } from './CTAButtonHandler';
import { TutorialController } from './TutorialController';
const { ccclass, property } = _decorator;

@ccclass('CategoryElement')
export class CategoryElement {
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

    private timerStarted: boolean = false;
    private gameEnded: boolean = false;
    private remainingTime: number = 0;
    private tutorialGuideVisible: boolean = false;
    private tutorialGuideBaseScale: Vec3 = Vec3.ONE.clone();
    private tutorialController: TutorialController | null = null;
    private tutorialTargetStage: number = 0;
    private idleHintActive: boolean = false;
    private idleHintTimer: number = 0;
    private idleHintSourceColumn: Node[] | null = null;
    private idleHintDestinationColumn: Node[] | null = null;
    private idleHintStage: number = 0; // 0 = no hint, 1 = showing source, 2 = showing destination
    private idleHintOriginalScales: Map<Node, Vec3> = new Map();

    start() {
        this.initializeColumns();
        this.buildCategoryLookup();
        this.setupTapHandlers();
        this.updateMatchedColumns();
        this.remainingTime = this.gameDurationSeconds;
        this.updateCountdownLabel();
        this.hideCtaNode();
        this.showGuideLabel();
        this.startTutorial();
        this.idleHintTimer = 0;
        this.idleHintActive = false;
        this.idleHintSourceColumn = null;
        this.idleHintDestinationColumn = null;
        this.idleHintStage = 0;
        this.idleHintOriginalScales.clear();
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

    private addTapHandler(item: Node) {
        if (this.tapHandlersRegistered.has(item)) {
            return;
        }

        const handler = () => {
            console.log('Tapped item', item.name);
            this.onItemTap(item);
        };

        item.on(Node.EventType.TOUCH_END, handler, this);
        item.on(Node.EventType.MOUSE_UP, handler, this);
        this.tapHandlersRegistered.add(item);
    }

    private setupTapHandlers() {
        if (!this.categoryElements.length) {
            console.warn('GameManager: categoryElements is empty. Assign categories in the inspector.');
            return;
        }

        const allItems = this.getAllItems();
        if (!allItems.length) {
            console.warn('GameManager: no items found. Assign items in categoryElements.');
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
        this.resetIdleHint();

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
            this.stopTutorial();
        }

        if (this.gameEnded || this.isSwapping) {
            return;
        }

        if (this.fakeCardNode && tappedItem.parent === this.fakeCardNode) {
            console.log('Tapped fixed swap slot, ignoring.');
            return;
        }

        if (this.swapCard && tappedItem === this.swapCard) {
            console.log('Tapped the fixed swapCard node, ignoring.');
            return;
        }

        const columnItems = this.boardColumns.find((column) => column.indexOf(tappedItem) !== -1);
        if (!columnItems || columnItems.length < this.itemsPerColumn) {
            console.warn('GameManager: tapped item column has fewer than', this.itemsPerColumn, 'items.');
            return;
        }

        if (this.completedColumns.has(columnItems)) {
            console.log('Tapped completed column, ignoring.');
            return;
        }

        this.swapColumnBottomWithSwapCard(columnItems);

        if (isFirstTutorialTap) {
            this.scheduleOnce(() => {
                this.startTutorial();
            }, 0.7);
        }
    }

    private isMatchingTutorialTarget(tappedItem: Node, targetNode: Node | null): boolean {
        return !!targetNode?.isValid && tappedItem === targetNode;
    }

    private resetIdleHint() {
        this.idleHintTimer = 0;
        this.idleHintStage = 0;
        this.hideIdleHint();
    }

    private showIdleHint() {
        if (this.idleHintActive || this.gameEnded || this.isSwapping) {
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
            console.log('GameManager: Creating new mark node for idle hint');
            markNode = this.createColumnMatchMark(column, items);
        } else {
            // Clean up any previous animation on mark node
            Tween.stopAllByTarget(markNode);
            console.log('GameManager: Reusing existing mark node, cleaned up tweens');
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
            // Deactivate to reset hand state completely
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
                const controller = tutorialRoot?.getComponent(TutorialController) || tutorialRoot?.getComponentInChildren(TutorialController);
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
                    if (matchingCount >= 2 && matchingCount < this.itemsPerColumn) {
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
        this.setColumnMatchedVisual(items, true, column, false);
        this.completedColumns.add(column);
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
                this.drawColumnMatchMark(markNode, new Color(62, 112, 202, 255));
            })
            .call(() => {
                if (opacity) {
                    opacity.opacity = 255;
                }
            })
            .start();
    }

    private drawStarParticle(particle: Node, color: Color) {
        const graphics = particle.getComponent(Graphics);
        if (!graphics) {
            return;
        }

        const outer = 9;
        const inner = 3.5;
        graphics.clear();
        graphics.fillColor = color;
        for (let i = 0; i < 8; i++) {
            const radius = i % 2 === 0 ? outer : inner;
            const angle = Math.PI * 0.25 * i - Math.PI * 0.5;
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
        const particleCount = 18;

        for (let i = 0; i < particleCount; i++) {
            const particle = new Node('columnStarParticle');
            particle.addComponent(UITransform).setContentSize(24, 24);
            particle.addComponent(Graphics);
            particle.addComponent(UIOpacity);
            particle.setParent(parent);
            particle.setSiblingIndex(parent.children.length - 1);

            const side = i % 4;
            const edgeX = side === 0 ? bounds.minX : side === 1 ? bounds.maxX : bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
            const edgeY = side === 2 ? bounds.minY : side === 3 ? bounds.maxY : bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
            const startLocal = parentTransform.convertToNodeSpaceAR(new Vec3(edgeX, edgeY, items[0].getWorldPosition(new Vec3()).z));
            const directionX = (edgeX - centerX) / Math.max(Math.abs(edgeX - centerX), 1);
            const directionY = (edgeY - centerY) / Math.max(Math.abs(edgeY - centerY), 1);
            const drift = 16 + Math.random() * 14;
            const endLocal = new Vec3(
                startLocal.x + directionX * drift / Math.max(parentScale.x, 0.01),
                startLocal.y + directionY * drift / Math.max(parentScale.y, 0.01),
                startLocal.z
            );
            const opacity = particle.getComponent(UIOpacity);
            const scale = 0.45 + Math.random() * 0.35;

            particle.setPosition(startLocal);
            particle.setScale(new Vec3(0.1, 0.1, 1));
            if (opacity) {
                opacity.opacity = 255;
            }
            this.drawStarParticle(particle, i % 3 === 0 ? new Color(255, 255, 255, 245) : new Color(255, 220, 64, 255));

            tween(particle)
                .delay(Math.random() * 0.05)
                .to(0.11, { scale: new Vec3(scale, scale, 1), position: endLocal }, { easing: easing.quadOut })
                .delay(0.08)
                .to(0.14, { scale: new Vec3(0.05, 0.05, 1) }, { easing: easing.quadIn })
                .call(() => particle.destroy())
                .start();
            if (opacity) {
                tween(opacity)
                    .delay(0.16)
                    .to(0.14, { opacity: 0 })
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
                    this.drawColumnMatchMark(markNode, new Color(62, 112, 202, 255));
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
        }, 0.62);
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

        tutorialRoot.active = true;
        this.scheduleOnce(() => {
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
                worldPosition.x = bounds.x + bounds.width * 0.5+60;
                worldPosition.y = bounds.y + bounds.height * 0.5 - 68;
            }
        }

        return worldPosition;
    }

    private stopTutorial() {
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
            console.log(`Game ended with ${result}; triggering CTA end screen.`);
            ctaHandler.onStoreButtonClicked();
        } else {
            console.warn('GameManager: CTAButtonHandler not found. Assign the CTA node in the inspector or attach the component to the game node.');
        }
    }

    private endGame(result: 'win' | 'loss') {
        if (this.gameEnded) {
            return;
        }

        this.gameEnded = true;
        this.timerStarted = false;
        this.remainingTime = 0;
        this.updateCountdownLabel();

        if (result === 'win') {
            console.log('Game over: you won.');
        } else {
            console.log('Game over: time is up.');
        }

        this.triggerCtaForEndScreen(result);
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


