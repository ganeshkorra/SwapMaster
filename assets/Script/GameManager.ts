import { _decorator, Component, Node, Vec3, tween, easing, Sprite, Color, Label, UITransform } from 'cc';
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

    @property({ type: Number })
    public itemsPerColumn: number = 4;

    start() {
        this.initializeColumns();
        this.buildCategoryLookup();
        this.setupTapHandlers();
        this.updateMatchedColumns();
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
                this.setColumnMatchedVisual(items, true, column, bottomItem, true);
                return;
            }

            if (items.length !== this.itemsPerColumn) {
                this.setColumnMatchedVisual(column, false, column, bottomItem, false);
                return;
            }

            const categoryId = this.getCategoryId(items[0]);
            const matched = categoryId !== -1 && items.every((item) => this.getCategoryId(item) === categoryId);
            if (matched) {
                this.completeColumn(column);
            } else {
                this.setColumnMatchedVisual(items, false, column, bottomItem, false);
            }
        });
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

    private createColumnMatchMark(column: Node[], bottomItem: Node): Node {
        const markNode = new Node('columnMatchMark');
        const uiTransform = markNode.addComponent(UITransform);
        uiTransform.setContentSize(256, 256);

        const label = markNode.addComponent(Label);
        label.string = '✓';
        label.fontSize = 80;
        label.color = new Color(255, 215, 0, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;

        markNode.setParent(bottomItem);
        const offsetY = this.getColumnMarkOffset(bottomItem);
        markNode.setPosition(new Vec3(0, -offsetY, 0));
        markNode.setScale(new Vec3(3, 3, 1));
        markNode.active = false;

        this.columnMatchMarks.set(column, markNode);
        return markNode;
    }

    private completeColumn(column: Node[]) {
        if (this.completedColumns.has(column)) {
            return;
        }
        const items = column.slice(0, this.itemsPerColumn);
        const bottomItem = column[column.length - 1];
        this.setColumnMatchedVisual(items, true, column, bottomItem, false);
        this.completedColumns.add(column);
    }

    private getColumnMarkOffset(bottomItem: Node): number {
        const uiTrans = bottomItem.getComponent(UITransform);
        if (uiTrans) {
            return uiTrans.contentSize.height * bottomItem.getScale().y * 0.8 + 200;
        }
        return 140;
    }

    private setColumnMatchedVisual(items: Node[], matched: boolean, column: Node[], bottomItem: Node, completed: boolean) {
        const highlightColor = matched ? new Color(120, 170, 255, 255) : new Color(255, 255, 255, 255);
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
                tween(item)
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

        let markNode = this.getColumnMatchMarkNode(column);
        if (!markNode && matched) {
            markNode = this.createColumnMatchMark(column, bottomItem);
        }
        if (markNode) {
            markNode.active = matched;
            if (matched) {
                const offsetY = this.getColumnMarkOffset(bottomItem);
                markNode.setPosition(new Vec3(0, -offsetY, 0));
            }
        }
    }

    public swapColumnBottomWithSwapCard(columnItems: Node[]) {
        if (!this.fakeCardNode) return;
        if (columnItems.length < this.itemsPerColumn) return;
        if (!this.fakeCardNode.children.length) return;

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

        // Refresh matched visuals after the swap.
        this.updateMatchedColumns();
    }

    update(deltaTime: number) {
        
    }
}


