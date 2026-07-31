import { useState, useEffect } from 'react';
import { InventoryItem } from '../services/api';
import { getSuggestedReorderQuantity } from '../utils/reorder';
import { X, Package } from 'lucide-react';
import { useModalDismiss } from '../hooks/useModalDismiss';

interface ReorderModalProps {
    item: InventoryItem;
    onConfirm: (quantity: number) => Promise<void>;
    onClose: () => void;
}

export const ReorderModal = ({ item, onConfirm, onClose }: ReorderModalProps) => {
    // Escape closes the dialog and the page behind it stops scrolling.
    useModalDismiss(onClose);

    const suggested = getSuggestedReorderQuantity(item);
    const [quantity, setQuantity] = useState(suggested.toString());
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Reset if a different item is opened while the modal is mounted
    useEffect(() => {
        setQuantity(getSuggestedReorderQuantity(item).toString());
        setError('');
    }, [item]);

    const parsedQuantity = parseInt(quantity, 10);
    const isValid = Number.isFinite(parsedQuantity) && parsedQuantity > 0;
    const newTotal = isValid ? item.quantity + parsedQuantity : item.quantity;

    const handleConfirm = async () => {
        if (!isValid) {
            setError('Enter a quantity greater than 0');
            return;
        }
        setError('');
        setIsSubmitting(true);
        try {
            await onConfirm(parsedQuantity);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to reorder item');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reorder-modal-title"
        >
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
                <div className="flex justify-between items-center p-6 border-b border-gray-200">
                    <h2 id="reorder-modal-title" className="text-xl font-semibold text-gray-800">Reorder Item</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                        <div className="bg-green-100 p-2 rounded-lg">
                            <Package className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <p className="font-medium text-gray-800">{item.name}</p>
                            <p className="text-sm text-gray-500">
                                Current stock: {item.quantity} {item.unit}
                            </p>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Quantity to add ({item.unit})
                        </label>
                        <input
                            type="number"
                            min="1"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none"
                            autoFocus
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            Suggested amount: {suggested} {item.unit} (covers ~14 days of usage
                            {item.min_stock_level ? `, or your minimum stock level` : ''})
                        </p>
                    </div>

                    <div className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-4 py-3">
                        <span className="text-sm text-gray-700">New stock level</span>
                        <span className="text-lg font-semibold text-green-700">
                            {newTotal} {item.unit}
                        </span>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={isSubmitting || !isValid}
                            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? 'Reordering...' : 'Confirm Reorder'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};