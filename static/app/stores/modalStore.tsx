import {createStore, StoreDefinition} from 'reflux';

import {ModalOptions, ModalRenderProps} from 'sentry/actionCreators/modal';

type Renderer = (renderProps: ModalRenderProps) => React.ReactNode;

type ModalStoreState = {
  options: ModalOptions;
  renderer: Renderer | null;
};

interface ModalStoreDefinition extends StoreDefinition {
  closeModal(): void;
  get(): ModalStoreState;
  getState(): ModalStoreState;
  init(): void;
  openModal(renderer: Renderer, options: ModalOptions): void;
  reset(): void;
}

const storeConfig: ModalStoreDefinition = {
  init() {
    // XXX: Do not use `this.listenTo` in this store. We avoid usage of reflux
    // listeners due to their leaky nature in tests.

    this.reset();
  },

  get() {
    return this.state;
  },

  getState() {
    return this.state;
  },

  reset() {
    this.state = {
      renderer: null,
      options: {},
    } as ModalStoreState;
  },

  closeModal() {
    this.reset();
    this.trigger(this.state);
  },

  openModal(renderer: Renderer, options: ModalOptions) {
    this.state = {renderer, options};
    this.trigger(this.state);
  },
};

const ModalStore = createStore(storeConfig);
export default ModalStore;
