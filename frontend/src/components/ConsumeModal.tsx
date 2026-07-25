import { useState, useEffect } from 'react';
import { InventoryItem } from '../services/api';
import { X, Minus } from 'lucide-react';

interface ConsumeModalProps {
    item: InventoryItem;
    onConfirm: (quantity: number) => Promise<void>;
    onClose: () => void;
}

export const ConsumeModal = ({ item, onConfirm, onClose }: ConsumeModalProps) => {
    const [quantity, setQuantity] = useState('1');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Reset if a different item is opened while the modal is mounted
    useEffect(() => {
        setQuantity('1');
        setError('');
    }, [item]);

    const parsedQuantity = parseInt(quantity, 10);
    // Only gates the submit button on "is this a number at all" — whether it
    // exceeds available stock is deliberately left to handleConfirm's
    // explicit check below, which surfaces a clear inline error message
    // instead of just silently disabling the button with no explanation.
    const isValid = Number.isFinite(parsedQuantity) && parsedQuantity > 0;
    // Clamping at 0 for the preview would otherwise render an over-stock
    // entry as a confident "0 — Out of stock", contradicting the validation
    // error right above it and implying the consume would go through.
    const exceedsStock = Number.isFinite(parsedQuantity) && parsedQuantity > item.quantity;
    const newTotal = Number.isFinite(parsedQuantity) ? Math.max(0, item.quantity - parsedQuantity) : item.quantity;

    const handleConfirm = async () => {
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
            setError('Enter a quantity greater than 0');
            return;
        }
        if (parsedQuantity > item.quantity) {
            setError(`Cannot consume more than the ${item.quantity} ${item.unit} in stock`);
            return;
        }
        setError('');
        setIsSubmitting(true);
        try {
            await onConfirm(parsedQuantity);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to consume item');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
                <div className="flex justify-between items-center p-6 border-b border-gray-200">
                    <h2 className="text-xl font-semibold text-gray-800">Consume Item</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                        <div className="bg-orange-100 p-2 rounded-lg">
                            <Minus className="w-5 h-5 text-orange-600" />
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
                            Quantity to consume ({item.unit})
                        </label>
                        <input
                            type="number"
                            min="1"
                            max={item.quantity}
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                            autoFocus
                        />
                        <p className="mt-1 text-xs text-gray-500">
                            You can consume up to the full {item.quantity} {item.unit} currently in stock.
                        </p>
                    </div>

                    <div className={`flex items-center justify-between border rounded-lg px-4 py-3 ${exceedsStock ? 'bg-gray-50 border-gray-200' : newTotal === 0 ? 'bg-red-50 border-red-100' : 'bg-orange-50 border-orange-100'}`}>
                        <span className="text-sm text-gray-700">New stock level</span>
                        {exceedsStock ? (
                            <span className="text-sm font-medium text-gray-500">
                                Exceeds available stock
                            </span>
                        ) : (
                            <span className={`text-lg font-semibold ${newTotal === 0 ? 'text-red-700' : 'text-orange-700'}`}>
                                {newTotal} {item.unit}
                                {newTotal === 0 && ' — Out of stock'}
                            </span>
                        )}
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
                            className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? 'Consuming...' : 'Confirm Consume'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
