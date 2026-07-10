import { _decorator, Component, Node, Vec3 } from 'cc';
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

    @property({ type: Number })
    public itemsPerColumn: number = 4;

    start() {
        this.initializeColumns();
        this.setupTapHandlers();
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

        allItems.forEach((item) => {
            const handler = () => {
                console.log('Tapped item', item.name);
                this.onItemTap(item);
            };

            item.on(Node.EventType.TOUCH_END, handler, this);
            item.on(Node.EventType.MOUSE_UP, handler, this);
        });
    }

    public onItemTap(tappedItem: Node) {
        const columnItems = this.boardColumns.find((column) => column.includes(tappedItem));
        if (!columnItems || columnItems.length < this.itemsPerColumn) {
            console.warn('GameManager: tapped item column has fewer than', this.itemsPerColumn, 'items.');
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

        bottomItem.setParent(this.fakeCardNode);
        bottomItem.setWorldPosition(fakeCardWorldPos);
        bottomItem.setWorldScale(bottomItemScale);

        swapCardItem.setParent(columnParent);
        swapCardItem.setWorldPosition(slotPositions[0]);
        swapCardItem.setWorldScale(swapCardScale);

        // Shift the remaining cards down one slot.
        for (let i = 0; i < this.itemsPerColumn - 1; i++) {
            columnItems[i].setWorldPosition(slotPositions[i + 1]);
        }

        // Update the board column state for future taps.
        const newColumnItems = [swapCardItem, ...columnItems.slice(0, this.itemsPerColumn - 1)];
        columnItems.length = 0;
        newColumnItems.forEach((item) => columnItems.push(item));
    }

    update(deltaTime: number) {
        
    }
}


