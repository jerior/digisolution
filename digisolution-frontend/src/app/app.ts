import {Component, OnDestroy, OnInit, signal} from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  Observable,
  startWith,
  Subject,
  switchMap, takeUntil, tap
} from 'rxjs';
import { HttpClient } from '@angular/common/http';
import {FormsModule} from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { environment } from '../environments/environment';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {MatButtonModule} from '@angular/material/button';

interface Item {
  id: number;
}

interface ItemsResponse {
  items: Item[];
  total: number;
  hasMore: boolean;
  order?: number[];
}

@Component({
  selector: 'app-root',
  imports: [FormsModule, AsyncPipe, MatProgressBarModule, MatButtonModule],
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit, OnDestroy {
  private apiUrl = environment.apiUrl;
  private destroy$ = new Subject<void>();

  // State streams
  private leftFilterSubject = new BehaviorSubject<string>('');
  private rightFilterSubject = new BehaviorSubject<string>('');
  private newItemIdSubject = new BehaviorSubject<number | null>(null);

  private leftPageSubject = new BehaviorSubject<number>(0);
  private rightPageSubject = new BehaviorSubject<number>(0);

  // Индикаторы синхронизации с сервером
  private leftSyncingSubject = new BehaviorSubject<boolean>(false);
  private rightSyncingSubject = new BehaviorSubject<boolean>(false);

  private leftHasMoreSubject = new BehaviorSubject<boolean>(true);
  private rightHasMoreSubject = new BehaviorSubject<boolean>(true);

  private availableItemsSubject = new BehaviorSubject<Item[]>([]);
  private selectedItemsSubject = new BehaviorSubject<Item[]>([]);

  private refreshLeftSubject = new Subject<void>();
  private refreshRightSubject = new Subject<void>();

  // Public observables for template
  leftFilter$ = this.leftFilterSubject.asObservable();
  rightFilter$ = this.rightFilterSubject.asObservable();
  newItemId$ = this.newItemIdSubject.asObservable();

  leftSyncing$ = this.leftSyncingSubject.asObservable();
  rightSyncing$ = this.rightSyncingSubject.asObservable();

  rightHasMoreSubject$ = this.rightHasMoreSubject.asObservable();
  leftHasMoreSubject$ = this.leftHasMoreSubject.asObservable();

  availableItems$ = this.availableItemsSubject.asObservable();
  selectedItems$ = this.selectedItemsSubject.asObservable();

  private draggedIndex: number | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.setupLeftItemsStream();
    this.setupRightItemsStream();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private setupLeftItemsStream() {
    // Stream для загрузки доступных элементов
    combineLatest([
      this.leftFilterSubject.pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => {
          this.leftPageSubject.next(0);
          this.availableItemsSubject.next([]);
          this.leftHasMoreSubject.next(true);
        })
      ),
      this.leftPageSubject,
      this.refreshLeftSubject.pipe(startWith(undefined))
    ]).pipe(
      switchMap(([filter, page]) => {
        if (!this.leftHasMoreSubject.value && page > 0) {
          return new Observable<ItemsResponse>(observer => {
            observer.next({ items: [], total: 0, hasMore: false });
            observer.complete();
          });
        }

        this.leftSyncingSubject.next(true);

        return this.http.get<ItemsResponse>(`${this.apiUrl}/items/available`, {
          params: {
            page: page.toString(),
            limit: '20',
            filter: filter
          }
        }).pipe(
          tap(() => this.leftSyncingSubject.next(false))
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        const currentItems = this.availableItemsSubject.value;
        this.availableItemsSubject.next([...currentItems, ...response.items]);
        this.leftHasMoreSubject.next(response.hasMore);
      },
      error: () => {
        this.leftSyncingSubject.next(false);
      }
    });
  }

  private setupRightItemsStream() {
    // Stream для загрузки выбранных элементов
    combineLatest([
      this.rightFilterSubject.pipe(
        debounceTime(100),
        distinctUntilChanged(),
        tap(() => {
          this.rightPageSubject.next(0);
          this.selectedItemsSubject.next([]);
          this.rightHasMoreSubject.next(true);
        })
      ),
      this.rightPageSubject,
      this.refreshRightSubject.pipe(startWith(undefined))
    ]).pipe(
      switchMap(([filter, page]) => {
        if (!this.rightHasMoreSubject.value && page > 0) {
          return new Observable<ItemsResponse>(observer => {
            observer.next({ items: [], total: 0, hasMore: false });
            observer.complete();
          });
        }

        this.rightSyncingSubject.next(true);

        return this.http.get<ItemsResponse>(`${this.apiUrl}/items/selected`, {
          params: {
            page: page.toString(),
            limit: '20',
            filter: filter
          }
        }).pipe(
          tap(() => this.rightSyncingSubject.next(false))
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (response) => {
        const currentItems = this.selectedItemsSubject.value;
        this.selectedItemsSubject.next([...currentItems, ...response.items]);
        this.rightHasMoreSubject.next(response.hasMore);
      },
      error: () => {
        this.rightSyncingSubject.next(false);
      }
    });
  }

  onLeftFilterChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.leftFilterSubject.next(value);
  }

  onRightFilterChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.rightFilterSubject.next(value);
  }

  onNewItemIdChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.newItemIdSubject.next(value ? parseInt(value) : null);
  }

  onLeftScroll(event: Event) {
    const element = event.target as HTMLElement;
    const bottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;

    if (bottom && !this.leftSyncingSubject.value && this.leftHasMoreSubject.value) {
      this.leftPageSubject.next(this.leftPageSubject.value + 1);
    }
  }

  onRightScroll(event: Event) {
    const element = event.target as HTMLElement;
    const bottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;

    if (bottom && !this.rightSyncingSubject.value && this.rightHasMoreSubject.value) {
      this.rightPageSubject.next(this.rightPageSubject.value + 1);
    }
  }

  checkAndLoadMoreLeft() {
    const container = document.querySelector('.left-panel .items-container') as HTMLElement;
    if (!container) return;

    const hasScroll = container.scrollHeight > container.clientHeight;

    // Если нет скролла и есть еще данные, загружаем следующую страницу
    if (!hasScroll && this.leftHasMoreSubject.value && !this.leftSyncingSubject.value) {
      this.leftPageSubject.next(this.leftPageSubject.value + 1);
    }
  }

  checkAndLoadMoreRight() {
    const container = document.querySelector('.right-panel .items-container') as HTMLElement;
    if (!container) return;

    const hasScroll = container.scrollHeight > container.clientHeight;

    // Если нет скролла и есть еще данные, загружаем следующую страницу
    if (!hasScroll && this.rightHasMoreSubject.value && !this.rightSyncingSubject.value) {
      this.rightPageSubject.next(this.rightPageSubject.value + 1);
    }
  }

  selectItem(item: Item) {
    // Оптимистичное обновление UI - сразу показываем изменения
    const available = this.availableItemsSubject.value.filter(i => i.id !== item.id);
    this.availableItemsSubject.next(available);

    const selected = [...this.selectedItemsSubject.value, item];
    this.selectedItemsSubject.next(selected);

    // Показываем индикатор синхронизации
    this.rightSyncingSubject.next(true);

    // Отправляем запрос на сервер
    this.http.post(`${this.apiUrl}/items/select`, { id: item.id })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          // Обновляем из API через 1 секунду (после батчинга)
          setTimeout(() => {
            this.refreshSelectedFromServer();
          }, 1100);
        },
        error: (err) => {
          // При ошибке откатываем изменения
          console.error('Error selecting item:', err);
          this.availableItemsSubject.next([...this.availableItemsSubject.value, item]);
          const revertSelected = this.selectedItemsSubject.value.filter(i => i.id !== item.id);
          this.selectedItemsSubject.next(revertSelected);
          this.rightSyncingSubject.next(false);
          alert('Ошибка при выборе элемента. Попробуйте снова.');
        }
      });
  }

  deselectItem(item: Item) {
    // Оптимистичное обновление UI - сразу показываем изменения
    const selected = this.selectedItemsSubject.value.filter(i => i.id !== item.id);
    this.selectedItemsSubject.next(selected);

    const available = [...this.availableItemsSubject.value, item];
    this.availableItemsSubject.next(available);

    // Показываем индикатор синхронизации
    this.leftSyncingSubject.next(true);

    // Отправляем запрос на сервер
    this.http.post(`${this.apiUrl}/items/deselect`, { id: item.id })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          // Обновляем из API через 1 секунду (после батчинга)
          setTimeout(() => {
            this.refreshAvailableFromServer();
          }, 1100);
        },
        error: (err) => {
          // При ошибке откатываем изменения
          console.error('Error deselecting item:', err);
          this.selectedItemsSubject.next([...this.selectedItemsSubject.value, item]);
          const revertAvailable = this.availableItemsSubject.value.filter(i => i.id !== item.id);
          this.availableItemsSubject.next(revertAvailable);
          this.leftSyncingSubject.next(false);
          alert('Ошибка при отмене выбора. Попробуйте снова.');
        }
      });
  }

  // Метод для обновления выбранных элементов с сервера
  private refreshSelectedFromServer() {
    this.http.get<ItemsResponse>(`${this.apiUrl}/items/selected`, {
      params: {
        page: '0',
        limit: '1000', // Загружаем все для синхронизации
        filter: ''
      }
    }).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          // Обновляем список из API (источник истины)
          this.selectedItemsSubject.next(response.items);
          this.rightSyncingSubject.next(false);
        },
        error: (err) => {
          console.error('Error refreshing selected items:', err);
          this.rightSyncingSubject.next(false);
        }
      });
  }

  // Метод для обновления доступных элементов с сервера
  private refreshAvailableFromServer() {
    this.http.get<ItemsResponse>(`${this.apiUrl}/items/available`, {
      params: {
        page: '0',
        limit: '1000', // Загружаем все для синхронизации
        filter: ''
      }
    }).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          // Обновляем список из API (источник истины)
          this.availableItemsSubject.next(response.items);
          this.leftSyncingSubject.next(false);
        },
        error: (err) => {
          console.error('Error refreshing available items:', err);
          this.leftSyncingSubject.next(false);
        }
      });
  }

  addNewItem() {
    const newId = this.newItemIdSubject.value;
    if (!newId) return;

    this.http.post(`${this.apiUrl}/items`, { id: newId })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.newItemIdSubject.next(null);

          // Обновляем доступные через 10 секунд (после батчинга)
          setTimeout(() => {
            this.leftPageSubject.next(0);
            this.leftHasMoreSubject.next(true);
            this.availableItemsSubject.next([]);
            this.refreshLeftSubject.next();
          }, 10000);
        },
        error: (err) => {
          alert(err.error?.error || 'Ошибка добавления');
        }
      });
  }

  onDragStart(event: DragEvent, index: number) {
    this.draggedIndex = index;
    event.dataTransfer!.effectAllowed = 'move';
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
  }

  onDrop(event: DragEvent, targetIndex: number) {
    event.preventDefault();

    if (this.draggedIndex === null || this.draggedIndex === targetIndex) return;

    const items = [...this.selectedItemsSubject.value];
    const draggedItem = items[this.draggedIndex];
    items.splice(this.draggedIndex, 1);
    items.splice(targetIndex, 0, draggedItem);

    this.selectedItemsSubject.next(items);

    const newOrder = items.map(item => item.id);
    this.http.post(`${this.apiUrl}/items/reorder`, { order: newOrder })
      .pipe(takeUntil(this.destroy$))
      .subscribe();

    this.draggedIndex = null;
  }
}
