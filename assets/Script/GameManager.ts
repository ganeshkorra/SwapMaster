import { _decorator, Component, Node, Vec3, tween, easing, Sprite, Color, UITransform, Graphics, UIOpacity } from 'cc';
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
        if (this.isSwapping) {
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

    update(deltaTime: number) {
        
    }
}


