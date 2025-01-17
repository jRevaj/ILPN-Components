import {SvgWrapper} from './svg-wrapper';
import {DRAG_POINT_STYLE} from '../../constants/drag-point-style';


export class DragPoint extends SvgWrapper {

    constructor(id?: string) {
        super(id);

        const dragPoint = this.createSvgElement('circle');
        this.applyStyle(dragPoint, DRAG_POINT_STYLE);
        dragPoint.classList.add('drag-point');
        this.registerMainElement(dragPoint);
    }

    protected override svgX(): string {
        return 'cx';
    }

    protected override svgY(): string {
        return 'cy';
    }
}
